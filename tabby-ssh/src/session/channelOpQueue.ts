export interface ChannelOpQueue {
    push: (op: () => Promise<void>) => void
}

/**
 * Runs channel operations one at a time, in call order.
 * russh's async Channel.write()/eof()/close() calls are not ordered when fired
 * concurrently, so forwarded bytes could reach the peer reordered or after EOF.
 * After the first failure, onError is called and the remaining ops are dropped.
 */
export function createChannelOpQueue (onError: (err: unknown) => void): ChannelOpQueue {
    let tail = Promise.resolve()
    let failed = false
    return {
        push: op => {
            tail = tail.then(async () => {
                if (!failed) {
                    await op()
                }
            }).catch(err => {
                failed = true
                onError(err)
            })
        },
    }
}
