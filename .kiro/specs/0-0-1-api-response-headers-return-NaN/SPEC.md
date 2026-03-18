# API Response Headers Return NaN

The response headers `X-RateLimit-Reset` and `X-RateLimit-Remaining` both return NaN. This is most likely because we do not have anything set up to store this information.

I want to use the existing settings and utility for rate limits and extend it to incorporate storage and proper decrements and refresh.

We will need a central DynamoDB table to store rate limits and TTL for reset. It should be keyed by client identifier (IP or User Identifier depending upon if it is a public, registered, paid, or private tier). The identifier should be a hashed value. This should also store session tokens or other relevant session information which may be used in the future. This database could be named *-sessions with a logical name in the template as `DynamoDbSessions`.

Rate limit windows/ranges as well as the number of requests within the window are available via settings.js `rateLimits`

Rate limit windows should be set on the mark of the minute, hour or day. For example, if a window were set to 5 minutes then at 4:00, 4:05, 4:10, etc it would reset. It is not based upon the first request.

Similarly, if it were set to 60 minutes it would reset at 2:00, 3:00, 4:00. 

If set to 120 minutes it would reset on every even hour: 2:00, 4:00, 6:00, etc.

If set to 240 minutes it would reset on every 4th hour of the day: 4:00, 8:00, etc

For 24 hours it would reset at midnight `Etc/UTC`.

By default the timezone is `Etc/UTC`. This may be changed in the future, but for now we use this. (offsetInMinutes will be used in the future for this)

This can be calculated using:

```js
  const convertFromMinutesToMilli(seconds) { /* ... */ }
  const convertFromMilliToMinutes(milliSeconds) { /* ... */ } // rounds up to nearest minute

	const nextIntervalInMinutes = function(intervalInMinutes, offsetInMinutes = 0 ) {

		const timestampInMinutes = convertFromMilliToMinutes(Date.now());

		/* We do an offset conversion by adjusting the timestamp to a "local"
		time. This is purely for calculations and is not used as a "date".
		*/

		// Add in offset so we can calculate from midnight local time - FUTURE USE
		timestampInMinutes += offsetInMinutes;

		// convert the minutes into a date
		let date = new Date( convertFromMinutesToMilli(timestampInMinutes) );

		// https://stackoverflow.com/questions/10789384/round-a-date-to-the-nearest-5-minutes-in-javascript
		let coeff = convertFromMinutesToMilli(intervalInMinutes);
		let rounded = new Date(Math.ceil(date.getTime() / coeff) * coeff);
		let nextInMinutes = convertFromMilliToMinutes(rounded.getTime());

		// revert the offset so we are looking at UTC
		nextInMinutes -= offsetInMinutes;

		return nextInMinutes;
	};
```

We should use an In-Memory Cache similar to how one is implemented in 63klabs/cache-data

- HOWEVER it should only be used for quick access of the last known state of the user's rate limit. For example, if a user's rate is in the in memory cache, it can be used to quickly determine the window and remaining rate. 
- HOWEVER in the background it should update and fetch the real data from DynamoDB. 

The function can quickly grab the in memory cache data and go on to process the request while DynamoDB updates in the background. 

HOWEVER there needs to be a promise that needs to be awaited before the user's response can be returned to ensure the dynamodb update completes.

Here is an example if in memory cache from cache-data (NOTE we need to implement this differently to accomodate your use case.)

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
 /* 1. If entry exists in cache, is still within the window, and has not reached 0:
       1. Before resolving, trigger fetchEntry() which is async and returns a promise. 
       2. Resolve get by returning the entry along with the updateEntry update promise in an object {data, fetchPromise}
       3. The handler will process the request and before returning a response, await the fetchPromise
    2. If entry does not exist in cache (or expired), await fetch from DynamoDB. If not in DynamoDB create one in mem and Dynamo. Return putPromise for creation in the resolved data {data, putPromise}
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
The current utility for rate-limiter cleans up the in memory cache for expired entries. The same should be done here.

Review documentation and tests to determine if anything else needs to be updated.

Ask any clarifying questions or make recomendations that I should pick from in SPEC-QUESTIONS.md and I will answer them there before we move on to the requirements stage.