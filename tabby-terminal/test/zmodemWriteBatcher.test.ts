import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ZModemWriteBatcher } from '../src/features/zmodemWriteBatcher.ts'

const KB = 1024
const MB = 1024 * KB

/** zmodem.js hands on_input a plain Array of octets per ~1 KB subpacket */
function payload (i: number): number[] {
    return new Array(KB).fill(i % 256)
}

function recorder (delayMs = 0) {
    const writes: Buffer[] = []
    let inFlight = 0
    let maxInFlight = 0
    const write = async (data: Buffer) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        writes.push(data)
        inFlight--
    }
    return { writes, write, maxInFlight: () => maxInFlight }
}

describe('ZModemWriteBatcher', () => {
    it('coalesces small payloads into large writes', async () => {
        const r = recorder()
        const batcher = new ZModemWriteBatcher(r.write, () => undefined)
        for (let i = 0; i < 3000; i++) {
            batcher.push(payload(i))
        }
        await batcher.flush()

        // 3000 KB in 1 MB blocks: two full blocks plus the remainder
        assert.equal(r.writes.length, 3)
        assert.deepEqual(r.writes.map(w => w.length), [MB, MB, 3000 * KB - 2 * MB])
    })

    it('writes every byte in order', async () => {
        const r = recorder()
        const batcher = new ZModemWriteBatcher(r.write, () => undefined, 4 * KB)
        const expected: number[] = []
        for (let i = 0; i < 37; i++) {
            const chunk = payload(i).slice(0, 100 + i)
            expected.push(...chunk)
            batcher.push(chunk)
        }
        await batcher.flush()
        assert.deepEqual([...Buffer.concat(r.writes)], expected)
    })

    it('never runs two writes at once', async () => {
        const r = recorder(2)
        const batcher = new ZModemWriteBatcher(r.write, () => undefined, 2 * KB)
        for (let i = 0; i < 20; i++) {
            batcher.push(payload(i))
        }
        await batcher.flush()
        assert.equal(r.writes.length, 10)
        assert.equal(r.maxInFlight(), 1)
    })

    it('copies payloads so later changes to the source array do not leak in', async () => {
        const r = recorder()
        const batcher = new ZModemWriteBatcher(r.write, () => undefined)
        const chunk = [1, 2, 3]
        batcher.push(chunk)
        chunk[0] = 9
        await batcher.flush()
        assert.deepEqual([...r.writes[0]], [1, 2, 3])
    })

    it('reports a failed write and keeps writing the rest', async () => {
        const errors: unknown[] = []
        const written: Buffer[] = []
        let calls = 0
        const batcher = new ZModemWriteBatcher(async data => {
            if (calls++ === 0) {
                throw new Error('disk full')
            }
            written.push(data)
        }, err => errors.push(err), KB)
        batcher.push(payload(0))
        batcher.push(payload(1))
        await batcher.flush()
        assert.equal(errors.length, 1)
        assert.equal(written.length, 1)
        assert.equal(written[0][0], 1)
    })

    it('flush() with nothing pending does not write', async () => {
        const r = recorder()
        const batcher = new ZModemWriteBatcher(r.write, () => undefined)
        await batcher.flush()
        assert.equal(r.writes.length, 0)
    })
})
