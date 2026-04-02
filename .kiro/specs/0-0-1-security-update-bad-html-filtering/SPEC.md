# Bad HTML filtering regexp

The following security review was submitted by GitHub automated code review. Ask any clarifying questions in SPEC-QUESTIONS.md and I will review and answer there before we begin a spec driven workflow.

application-infrastructure/tests/postdeploy/unit/landing-page.test.js:42
```js
    // No <script src="..."> tags
    expect(html).not.toMatch(/<script[^>]+src=/);
    // No inline <script> blocks
    expect(html).not.toMatch(/<script[\s>]/);
// Warning
// Bad HTML filtering regexp
// This regular expression does not match upper case <SCRIPT> tags.
// CodeQL
    // No common framework references
    expect(html.toLowerCase()).not.toMatch(/react/);
    expect(html.toLowerCase()).not.toMatch(/angular/);
```

It is possible to match some single HTML tags using regular expressions (parsing general HTML using regular expressions is impossible). However, if the regular expression is not written well it might be possible to circumvent it, which can lead to cross-site scripting or other security issues.

Some of these mistakes are caused by browsers having very forgiving HTML parsers, and will often render invalid HTML containing syntax errors. Regular expressions that attempt to match HTML should also recognize tags containing such syntax errors.

## Recommendation

Use a well-tested sanitization or parser library if at all possible. These libraries are much more likely to handle corner cases correctly than a custom implementation.
Example

The following example attempts to filters out all <script> tags.

```js
function filterScript(html) {
    var scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    var match;
    while ((match = scriptRegex.exec(html)) !== null) {
        html = html.replace(match[0], match[1]);
    }
    return html;
}
```

The above sanitizer does not filter out all `<script>` tags. Browsers will not only accept `</script>` as script end tags, but also tags such as `</script foo="bar"> `even though it is a parser error. This means that an attack string such as `<script>alert(1)</script foo="bar">` will not be filtered by the function, and `alert(1)` will be executed by a browser if the string is rendered as HTML.

Other corner cases include that HTML comments can end with --!>, and that HTML tag names can contain upper case characters.