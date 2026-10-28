const DEFAULT_BATCH_SIZE = 1024 * 1024

/**
 * Collects the small (~1 KB) payloads zmodem.js emits while receiving a file
 * and writes them out serially in large blocks.
 *
 * Queueing one write per payload kept every payload (a plain number[]) and its
 * closure alive until the disk caught up, so large downloads ran the renderer
 * out of memory (#11590). Payloads are copied into a Buffer right away and
 * written once `batchSize` bytes have accumulated.
 */
export class ZModemWriteBatcher {
    private pending: Buffer[] = []
    private pendingBytes = 0
    private queue: Promise<void> = Promise.resolve()

    constructor (
        private write: (data: Buffer) => Promise<void>,
        private onError: (err: unknown) => void,
        private batchSize = DEFAULT_BATCH_SIZE,
    ) { }

    push (chunk: ArrayLike<number>): void {
        const data = Buffer.from(chunk as number[])
        this.pending.push(data)
        this.pendingBytes += data.length
        if (this.pendingBytes >= this.batchSize) {
            this.enqueuePending()
        }
    }

    /** Writes whatever is still pending and resolves once every write has finished */
    async flush (): Promise<void> {
        this.enqueuePending()
        await this.queue
    }

    private enqueuePending () {
        if (!this.pending.length) {
            return
        }
        const data = Buffer.concat(this.pending, this.pendingBytes)
        this.pending = []
        this.pendingBytes = 0
        this.queue = this.queue
            .then(() => this.write(data))
            .catch(err => this.onError(err))
    }
}
