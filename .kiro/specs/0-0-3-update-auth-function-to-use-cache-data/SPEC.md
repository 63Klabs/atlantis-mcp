# Update Auth Function to Use Cache-Data patterns

The auth function currently rolls its own routing, client request handling, and more.

As the number of endpoints it handles grows this will become unmanageable.

Also, since the API Gateway is behind CloudFront the path that comes in is different than if it came in direct through API Gateway therefore causing issues when changing between CloudFront and direct access.

The read function currently uses the MVC pattern and cache-data methods. Also, there is a new steering document (atlantis-webapi-node-cache-data.md) that can be used as reference as well.

## No Breaking Changes except path

The current endpoint specs should remain unchanged.
However, the endpoint path should include /mcp at the front.
Therefore /auth/profile becomes /mcp/auth/profile

## Clarifying questions, recommendations

Ask clarifying questions, provide recommendations and request confirmation, in SPEC-QUESTIONS.md. We must have all questions and recommendations answered and confirmed before moving on.

This is a major undertaking, and we need to think carefully before approaching requirements and design.