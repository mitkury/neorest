/**
 * A promise that tracks its state (pending, fulfilled, rejected)
 */
export class TrackedPromise<T> {
  private _original: Promise<T> | T;
  private _promise: Promise<T>;
  private _isPending: boolean = true;
  private _isFulfilled: boolean = false;
  private _isRejected: boolean = false;

  /**
   * Constructor
   * @param promiseOrValue - A promise or a value
   */
  constructor(promiseOrValue: Promise<T> | T) {
    this._original = promiseOrValue;

    if (promiseOrValue instanceof Promise) {
      this._promise = new Promise<T>((resolve, reject) => {
        promiseOrValue.then(
          (value) => {
            this._isPending = false;
            this._isFulfilled = true;
            resolve(value);
          },
          (reason) => {
            this._isPending = false;
            this._isRejected = true;
            reject(reason);
          }
        );
      });
    } else {
      this._isPending = false;
      this._isFulfilled = true;
      this._promise = Promise.resolve(promiseOrValue);
    }
  }

  /**
   * Get the original promise or value
   * @returns The original promise or value
   */
  getOriginal(): Promise<T> | T {
    return this._original;
  }

  /**
   * Check if the promise is pending
   */
  get isPending(): boolean {
    return this._isPending;
  }

  /**
   * Check if the promise is fulfilled
   */
  get isFulfilled(): boolean {
    return this._isFulfilled;
  }

  /**
   * Check if the promise is rejected
   */
  get isRejected(): boolean {
    return this._isRejected;
  }

  /**
   * Register callbacks for when the promise is fulfilled or rejected
   * @param onfulfilled - The callback for when the promise is fulfilled
   * @param onrejected - The callback for when the promise is rejected
   * @returns A new promise
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this._promise.then(onfulfilled, onrejected);
  }

  /**
   * Register a callback for when the promise is rejected
   * @param onrejected - The callback for when the promise is rejected
   * @returns A new promise
   */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this._promise.catch(onrejected);
  }

  /**
   * Register a callback that is called when the promise is settled
   * @param onfinally - The callback to call when the promise is settled
   * @returns A new promise
   */
  finally(onfinally?: (() => void) | null): Promise<T> {
    return this._promise.finally(onfinally);
  }
}