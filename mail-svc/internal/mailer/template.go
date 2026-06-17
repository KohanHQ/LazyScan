package mailer

import (
	"bytes"
	"fmt"
	"html/template"
)

const subject = "Your LazyScan verification code"

// plainBodyTemplate is the plain-text part, byte-identical to the original
// single-part body so text-only clients keep seeing the same email. The code
// lives only inside the rendered message — never in logs or error strings.
const plainBodyTemplate = `Your LazyScan verification code is:

	%s

It expires at %s. If you did not request this code, ignore this email.
`

// htmlBodyData feeds htmlBodyTemplate. Both values are server-generated, but
// html/template escapes them anyway.
type htmlBodyData struct {
	Code   string
	Expiry string
}

// htmlBodyTemplate is the HTML alternative part: table layout and inline
// styles only (the subset email clients reliably render), no remote images or
// fonts — rendering needs no network and leaks nothing to third parties.
// Palette mirrors the LazyScan web app (web/src/styles/base.css).
var htmlBodyTemplate = template.Must(template.New("verification").Parse(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your LazyScan verification code</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f2ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f2ec;">
<tr>
<td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#fffaf2;border:1px solid #ded8ce;border-radius:8px;">
<tr>
<td style="padding:32px;font-family:Helvetica,Arial,sans-serif;color:#17201b;">
<p style="margin:0 0 24px;font-size:18px;font-weight:bold;color:#0f6f5c;">LazyScan</p>
<p style="margin:0 0 8px;font-size:20px;font-weight:bold;">Verify your email</p>
<p style="margin:0 0 24px;font-size:14px;color:#43524a;">Use this code to finish registration:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center" style="background-color:#edf7f2;border:1px solid #d2ded8;border-radius:6px;padding:16px;">
<span style="font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:bold;letter-spacing:8px;color:#0f6f5c;">{{.Code}}</span>
</td>
</tr>
</table>
<p style="margin:24px 0 0;font-size:14px;color:#43524a;">It expires at {{.Expiry}}.</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #ded8ce;">
<p style="margin:0;font-size:12px;color:#66746d;">If you did not request this code, ignore this email.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
`))

// renderHTMLBody executes htmlBodyTemplate. The returned error never carries
// the code: template execution errors describe the template, not the data.
func renderHTMLBody(code, expiry string) (string, error) {
	var buf bytes.Buffer
	if err := htmlBodyTemplate.Execute(&buf, htmlBodyData{Code: code, Expiry: expiry}); err != nil {
		return "", fmt.Errorf("render html body: %w", err)
	}
	return buf.String(), nil
}
