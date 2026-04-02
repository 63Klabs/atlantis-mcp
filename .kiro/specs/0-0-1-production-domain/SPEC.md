# Production Domain

I want to be able to configure a production domain, and possible future settings, using application-infrastructure/src/static/settings.json

The settings.json should be set up as:

```json
{
    "default": {
        "footer": "<p>&copy; <span id=\"copyright-year\"></span> 63Klabs. All rights reserved.</p>"
    },
    "beta": {
        "domain": "mcp-beta.atlantis.63klabs.net"
    },
    "prod": {
        "domain": "mcp.atlantis.63klabs.net"
    }
}
```

The settings.json file uses the StageId from the PostDeploy environment variable to determine which set of values to use. Anything defined by "default" and not specified or overriden by the values in the StageId is used.

As of right now we will only specify two values, "footer" and "domain"

The settings.json file will be used to do various operations after static site generation such as find and replace.

Currently the footer html is placed at the bottom of the static pages. We want to replace it with the html in the footer defined in the settings.json file. We can implement this by instead of placing the footer html on each page place some placeholder text `{{{settings.footer}}}` during static generation and then do a final search/replace.

For "domain" not only would we want to replace `{{{settings.domain}}}` we also want to do a find/search and replace the `{apigwid}.execute-api.{region}.amazonaws.com/{atlantis-mcp-stage}` with the value listed for domain.

The domain replacement should be performed in the pandocs generated docs, and api doc, and downloadable openapi doc.