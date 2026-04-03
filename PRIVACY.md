# Data Privacy

This application provides a web service to both public and registered users.

As such, it will retain access logs for administrative and quality of service use. These logs will contain access time, IP address, User Agent, and feature accessed, During the beta release phase, these logs will be retained for up to 180 days.

Usage logs will be retained for understanding feature use, metrics, and determining development and maintenance priorities. Along with a basic client identifier (Kiro, Claude, Q, etc), tool used, and query parameters, usage logs will contain a session hash (to group related requests) but no user identifiable data will be stored with this data. These logs will be retained indefinately.

Access limits are enforced through the tracking of IP address (public) or user identifier (authenticated). Access logs contain a hash of the time window combined with the user identifier (IP or user identifier) and application-unique salt. The limit record only contains this hash and the number of requests remaining, and expiration. Data collected for enforcing limits are retained for only the time window of the imposed limit (24 hours or less depending on tier).

User profiles are not maintained for public users. However, authenticated users will have a profile record that contains information relevant to their subscription. Logs pertaining to usage by authenticated users includes total usage per window. Tools used, precise access times, and queries are not tied back to the user.

Data retention and collection practices may be reviewed through examination of the code in this repository.

These practices may be updated at any time by the party hosting the MCP Server. Previous versions may be reviewed through the repository history.
