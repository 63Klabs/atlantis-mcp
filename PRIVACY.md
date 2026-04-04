# Data Collection and Use

This application provides a web service to both public and registered users.

We collect limited technical and usage data necessary to operate the service, enforce access limits, improve functionality, and support subscription features. This may include IP address, user agent, feature usage, and query-related metadata.

- We collect limited technical and usage data (e.g., IP address, user agent, feature usage) to operate, secure, and improve the service.
- Public usage is not tied to identifiable individuals; authenticated users have minimal account data for subscription and usage tracking.
- Access logs are retained for up to 180 days; anonymized usage data is retained as needed for analytics and service improvement.
- Rate limiting uses short-lived hashed identifiers (IP or user ID) and is retained for 24 hours or less.
- We do not sell or share your data, except as required to operate the service or comply with law.
- Some data (like IP addresses) may be considered personal data, but we minimize identification and use aggregation where possible.
- Authenticated users may request access to or deletion of their account data.
- Full details and updates are available below and in the repository history.

## Data Collection

**Access Logs**
Access logs are retained for administrative and quality-of-service purposes. These logs include access time, IP address, user agent, and feature accessed. Access logs are retained for up to 180 days.

**Usage Logs**
Usage logs are used to understand feature usage and guide development priorities. These logs include a basic client identifier (e.g., Kiro, Claude, Q), tool used, query parameters, and a session hash used to group related requests. These logs are not tied to identifiable user accounts. Usage data is retained as long as necessary for operational and analytical purposes.

**Rate Limiting Data**
Access limits are enforced using IP address (public users) or user identifier (authenticated users). A hashed value derived from the identifier and time window is stored along with request counts and expiration. This data is retained only for the duration of the rate limit window (typically 24 hours or less).

**User Accounts**
Public users do not have profiles. Authenticated users have a profile containing subscription-related information. Usage metrics (such as total usage per time window) may be associated with accounts; however, detailed logs (such as queries or precise timestamps) are not tied back to individual users.

## Data Classification

Some collected data (such as IP addresses) may be considered personal data under applicable laws. However, this service does not attempt to directly identify individuals, and uses hashing and aggregation where possible to reduce identifiability.

## Data Sharing

We do not sell or share user data with third parties, except where required by law or necessary to operate the service (e.g., infrastructure providers).

## Data Security

Reasonable administrative and technical safeguards are in place to protect collected data.

## User Rights

Authenticated users may request access to or deletion of their account data, subject to operational and legal constraints.

## Transparency

Data collection and retention practices may be reviewed through the code in this repository. Changes to this policy may occur at any time, with prior versions available in repository history.
