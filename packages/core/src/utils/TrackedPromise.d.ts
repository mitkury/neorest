/**
 * A promise that tracks its state (pending, fulfilled, rejected)
 */
export declare class TrackedPromise<T> {
    private _original;
    private _promise;
    private _isPending;
    private _isFulfilled;
    private _isRejected;
    /**
     * Constructor
     * @param promiseOrValue - A promise or a value
     */
    constructor(promiseOrValue: Promise<T> | T);
    /**
     * Get the original promise or value
     * @returns The original promise or value
     */
    getOriginal(): Promise<T> | T;
    /**
     * Check if the promise is pending
     */
    get isPending(): boolean;
    /**
     * Check if the promise is fulfilled
     */
    get isFulfilled(): boolean;
    /**
     * Check if the promise is rejected
     */
    get isRejected(): boolean;
    /**
     * Register callbacks for when the promise is fulfilled or rejected
     * @param onfulfilled - The callback for when the promise is fulfilled
     * @param onrejected - The callback for when the promise is rejected
     * @returns A new promise
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
    /**
     * Register a callback for when the promise is rejected
     * @param onrejected - The callback for when the promise is rejected
     * @returns A new promise
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult>;
    /**
     * Register a callback that is called when the promise is settled
     * @param onfinally - The callback to call when the promise is settled
     * @returns A new promise
     */
    finally(onfinally?: (() => void) | null): Promise<T>;
}
//# sourceMappingURL=TrackedPromise.d.ts.map