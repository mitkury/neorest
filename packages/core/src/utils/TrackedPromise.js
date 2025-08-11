/**
 * A promise that tracks its state (pending, fulfilled, rejected)
 */
export class TrackedPromise {
    /**
     * Constructor
     * @param promiseOrValue - A promise or a value
     */
    constructor(promiseOrValue) {
        this._isPending = true;
        this._isFulfilled = false;
        this._isRejected = false;
        this._original = promiseOrValue;
        if (promiseOrValue instanceof Promise) {
            this._promise = new Promise((resolve, reject) => {
                promiseOrValue.then((value) => {
                    this._isPending = false;
                    this._isFulfilled = true;
                    resolve(value);
                }, (reason) => {
                    this._isPending = false;
                    this._isRejected = true;
                    reject(reason);
                });
            });
        }
        else {
            this._isPending = false;
            this._isFulfilled = true;
            this._promise = Promise.resolve(promiseOrValue);
        }
    }
    /**
     * Get the original promise or value
     * @returns The original promise or value
     */
    getOriginal() {
        return this._original;
    }
    /**
     * Check if the promise is pending
     */
    get isPending() {
        return this._isPending;
    }
    /**
     * Check if the promise is fulfilled
     */
    get isFulfilled() {
        return this._isFulfilled;
    }
    /**
     * Check if the promise is rejected
     */
    get isRejected() {
        return this._isRejected;
    }
    /**
     * Register callbacks for when the promise is fulfilled or rejected
     * @param onfulfilled - The callback for when the promise is fulfilled
     * @param onrejected - The callback for when the promise is rejected
     * @returns A new promise
     */
    then(onfulfilled, onrejected) {
        return this._promise.then(onfulfilled, onrejected);
    }
    /**
     * Register a callback for when the promise is rejected
     * @param onrejected - The callback for when the promise is rejected
     * @returns A new promise
     */
    catch(onrejected) {
        return this._promise.catch(onrejected);
    }
    /**
     * Register a callback that is called when the promise is settled
     * @param onfinally - The callback to call when the promise is settled
     * @returns A new promise
     */
    finally(onfinally) {
        return this._promise.finally(onfinally);
    }
}
//# sourceMappingURL=TrackedPromise.js.map