# API Response Headers Return NaN

The response headers X-RateLimit-Reset and X-RateLimit-Remaining both return NaN.

We also need a central DynamoDB table to store rate limits and TTL for reset. It should be keyed by IP or User Identifier depending upon if it is a public, registered, paid, or private tier. This should also store session tokens which may be used in the future.

Rate limit windows/ranges as well as the number of requests within the window are available via settings.js `rateLimits`

Rate limit windows should be set on the mark of the hour or day. For example, if a window were set to 5 minutes (300 seconds) then at 4:00, 4:05, 4:10, etc it would reset. It is not based upon the first request.

Similarly, if it were set to 1 hour (3600 seconds) it would reset at 2:00, 3:00, 4:00. For 24 hours it would reset at midnight `Etc/UTC`.

This can be calculated using:

```js
    const convertTimestampFromSecondsToMilli(seconds) { /* ... */ }
    const convertTimestampFromMilliToSeconds(milliSeconds) { /* ... */ }

	const nextIntervalInSeconds = function(intervalInSeconds, timestampInSeconds = 0, offsetInSeconds = 0 ) {

		// if no timestamp given, the default timestamp is now()
		if ( timestampInSeconds === 0 ) {
			timestampInSeconds = convertTimestampFromMilliToSeconds(Date.now());
		}

		/* We do an offset conversion by adjusting the timestamp to a "local"
		time. This is purely for calculations and is not used as a "date".
		*/

		// Add in offset so we can calculate from midnight local time - FUTURE USE
		timestampInSeconds += offset;

		// convert the seconds into a date
		let date = new Date( convertTimestampFromSecondsToMilli(timestampInSeconds) );

		// https://stackoverflow.com/questions/10789384/round-a-date-to-the-nearest-5-minutes-in-javascript
		let coeff = convertTimestampFromSecondsToMilli(intervalInSeconds);
		let rounded = new Date(Math.ceil(date.getTime() / coeff) * coeff);
		let nextInSeconds = convertTimestampFromMilliToSeconds(rounded.getTime());

		// revert the offset so we are looking at UTC
		nextInSeconds -= offset;

		return nextInSeconds;
	};
```

Logic will have to be implemented to set and decrement the user's allotted amount. If a record comes back for a user that has an expired TTL but has not yet been deleted by DynamoDB, then it should set a new record overwriting the old one.

Update the utility rate-limiter.js to use the new methods.

Be sure to utilize the cache-data AWS DynamoDB wrapper for get, put, scans, etc.

You can use an In-Memory Cache similar to how one is implemented in 63klabs/cache-data, HOWEVER it should only be used for quick access of the last known state of the user's rate limit. For example, if a user's rate is in the in memory cache, it can be used to quickly determine the window and remaining rate. HOWEVER in the background it should update and fetch the real data from DynamoDB. 

The function can quickly grab the inmemory cache data and go on to process the request while DynamoDB updates in the background. HOWEVER there needs to be a promise that needs to be awaited before the user's response can be returned to ensure the dynamodb update completes.

Here is an example if inmemory cache from cache-data (NOTE we're always passing through and updating the cache from DynamoDB, we just allow quick access to in memory to process the request and it is okay if we are off by a few remaining requests.)

```js
class InMemoryCache {
  #cache;
  #maxEntries;
  #memoryMB;

  constructor(options = {}) {
    const {
      maxEntries,
      entriesPerGB = 5000,
      defaultMaxEntries = 1000
    } = options;

    // Initialize Map storage
    this.#cache = new Map();

    // Determine MAX_ENTRIES
    if (maxEntries !== undefined && maxEntries !== null) {
      // Use explicit maxEntries parameter
      this.#maxEntries = maxEntries;
      this.#memoryMB = null;
    } else {
      // Calculate from Lambda memory allocation
      const lambdaMemory = process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE;
      
      if (lambdaMemory !== undefined && lambdaMemory !== null) {
        this.#memoryMB = parseInt(lambdaMemory, 10);
        
        if (!isNaN(this.#memoryMB) && this.#memoryMB > 0) {
          // Calculate: (memoryMB / 1024) * entriesPerGB
          this.#maxEntries = Math.floor((this.#memoryMB / 1024) * entriesPerGB);
        } else {
          // Invalid memory value, use default
          this.#maxEntries = defaultMaxEntries;
          this.#memoryMB = null;
        }
      } else {
        // Lambda memory not available, use default
        this.#maxEntries = defaultMaxEntries;
        this.#memoryMB = null;
      }
    }

    // Ensure maxEntries is at least 1
    if (this.#maxEntries < 1) {
      this.#maxEntries = 1;
    }
  }

 // >! Example ONLY! This function should be async.
 // Returns Promise<{data, Promise<newData>}>
 /* 1. If entry exists in cache, decrement (if limit already reached return data with 0 remaining and resolved promise)
    2. Before resolving, trigger fetchEntry() which is async and returns a promise. 
    3. Resolve get by returning the entry along with the updateEntry update promise in an object {data, fetchPromise}
    4. 

 */
  get(key) {
    // Check if key exists
    if (!this.#cache.has(key)) {
      return { cache: 0, data: null };
    }

    const entry = this.#cache.get(key);
    const now = Date.now();

    // Check if expired
    if (entry.expiresAt <= now) {
      // Delete expired entry
      this.#cache.delete(key);
      return { cache: -1, data: entry.value };
    }

    // Valid entry - update LRU position by deleting and re-setting
    this.#cache.delete(key);
    this.#cache.set(key, entry);

    return { cache: 1, data: entry.value };
  }

  set(key, value, expiresAt) {
    // If key exists, delete it first for LRU repositioning
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    }

    // Check capacity and evict if necessary
    if (this.#cache.size >= this.#maxEntries) {
      // Get first (oldest) entry
      const oldestKey = this.#cache.keys().next().value;
      this.#cache.delete(oldestKey);
    }

    // Store new entry
    this.#cache.set(key, { value, expiresAt });
  }

  /**
   * Clears all entries from the cache
   */
  clear() {
    this.#cache.clear();
  }

  /**
   * Returns information about the cache state
   * 
   * @returns {Object} Cache information
   * @returns {number} return.size - Current number of entries
   * @returns {number} return.maxEntries - Maximum capacity
   * @returns {number|null} return.memoryMB - Lambda memory allocation (if available)
   */
  info() {
    return {
      size: this.#cache.size,
      maxEntries: this.#maxEntries,
      memoryMB: this.#memoryMB
    };
  }
}

module.exports = InMemoryCache;
```

Review documentation and tests to determine if anything needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.