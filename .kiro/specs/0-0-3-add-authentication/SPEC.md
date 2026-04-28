# Add Authentication

We will be adding authentication to the MCP server. 

First, we need to explore methods to implement it without breaking the current public method of access.

There should be 4 Tiers of access:
1. Public: Free. Limits imposed using IP address (Current)
2. Registered: Free. Limits imposed per user account
3. Paid: Paid. Limits imposed per user account
4. Private: Free. Access granted by email domain (@63klabs.net, etc)

The Read Lambda config/settings.js lists the tiers and their limits:
```js
  rateLimits: {

    /**
     * Public rate limit (requests per window per IP address).
     * 
     * Applied to unauthenticated requests. Default: 50 requests per hour.
     * 
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 50)
     * @property {number} windowInMinutes - Time window in minutes (default: 60 = 1 hour)
     */
    public: {
      limitPerWindow: parseInt(process.env.MCP_PUBLIC_RATE_LIMIT || '50', 10),
      windowInMinutes: parseInt(process.env.MCP_PUBLIC_RATE_TIME_RANGE_MINUTES || '60', 10)
    },
    /**
     * Registered user rate limit (requests per window per user).
     * 
     * Applied to authenticated free-tier users. Default: 100 requests per hour.
     * 
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 100)
     * @property {number} windowInMinutes - Time window in minutes (default: 60 = 1 hour)
     */
    registered: {
      limitPerWindow: parseInt(process.env.MCP_REGISTERED_RATE_LIMIT || '100', 10),
      windowInMinutes: parseInt(process.env.MCP_REGISTERED_RATE_TIME_RANGE_MINUTES || '60', 10)
    },
    /**
     * Paid user rate limit (requests per window per user).
     * 
     * Applied to authenticated paid-tier users. Default: 3000 requests per day.
     * 
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 3000)
     * @property {number} windowInMinutes - Time window in minutes (default: 1440 = 24 hours)
     */
    paid: {
      limitPerWindow: parseInt(process.env.MCP_PAID_RATE_LIMIT || '3000', 10),
      windowInMinutes: parseInt(process.env.MCP_PAID_RATE_TIME_RANGE_MINUTES || '1440', 10)
    },
    /**
     * Private/admin rate limit (requests per window per user).
     * 
     * Applied to internal/admin access. Default: 6000 requests per day.
     * 
     * @type {Object}
     * @property {number} limitPerWindow - Maximum requests allowed (default: 6000)
     * @property {number} windowInMinutes - Time window in minutes (default: 1440 = 24 hours)
     */
    private: {
      limitPerWindow: parseInt(process.env.MCP_PRIVATE_RATE_LIMIT || '6000', 10),
      windowInMinutes: parseInt(process.env.MCP_PRIVATE_RATE_TIME_RANGE_MINUTES || '1440', 10)
    }

  }
```

## Authentication

Amazon Cognito will be used to manage access.

We may need multipe endpoints to drive traffic to the proper endpoint.

- Users should be able to self register.
- Once registed, users should be able to receive a secret key to use in their MCP configuration
- We will need to figure out a method for tier promotion, how does a free registered user become a paid registered user?
- Private accounts are manged manually by an administrator. Either individual accounts may be aded to an access list, (full email address) or the domain of the email address (@63klabs.net) to all allow all within a domain. (don't allow @yahoo.com, @gmail.com, etc)
- Registered users should be able to switch from a paid to free registered account. We will need a page for this with authentication. May need to include this in the post build with the static documentation site.
- We will need a button on the bottom of the main index.html document for the MCP site for users to update their profile.

## Documentation

When refering to limits in documentation, there should be a CENTRAL document with a table with limits listed. Limits should NOT be listed across documents as they can change.

## No Breaking Changes

The current public access should remain unchanged including the endpoint path

## Clarifying questions, recommendations

Ask clarifying questions, provide recommendations and request confirmation, in SPEC-QUESTIONS.md. We must have all questions and recommendations answered and confirmed before moving on.

This is a major undertaking, and we need to think carefully before approaching requirements and design.