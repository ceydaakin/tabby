import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createChannelOpQueue } from '../src/session/channelOpQueue.ts'

function deferred (): { promise: Promise<void>, resolve: () => void, reject: (err: Error) => void } {
    let resolve: () => void = () => undefined
    let reject: (err: Error) => void = () => undefined
    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

describe('channel op queue', () => {
    it('starts each op only after the previous one has finished', async () => {
        const started: string[] = []
        const pending = [deferred(), deferred(), deferred()]
        const queue = createChannelOpQueue(() => assert.fail('unexpected error'))

        queue.push(async () => { started.push('a'); await pending[0].promise })
        queue.push(async () => { started.push('b'); await pending[1].promise })
        queue.push(async () => { started.push('eof'); await pending[2].promise })

        await tick()
        assert.deepEqual(started, ['a'])

        pending[0].resolve()
        await tick()
        assert.deepEqual(started, ['a', 'b'])

        pending[1].resolve()
        await tick()
        assert.deepEqual(started, ['a', 'b', 'eof'])
        pending[2].resolve()
    })

    it('reports the first failure and drops the ops queued behind it', async () => {
        const errors: unknown[] = []
        const started: string[] = []
        const first = deferred()
        const queue = createChannelOpQueue(err => errors.push(err))

        queue.push(async () => { started.push('a'); await first.promise })
        queue.push(async () => { started.push('b') })
        first.reject(new Error('boom'))
        await tick()
        queue.push(async () => { started.push('c') })
        await tick()

        assert.deepEqual(started, ['a'])
        assert.equal(errors.length, 1)
        assert.equal((errors[0] as Error).message, 'boom')
    })
})
