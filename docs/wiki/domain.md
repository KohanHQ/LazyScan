# Domain

Self-upload manga reader: users upload metadata, covers, and chapter pages
themselves. No scraping, no external source ingestion — the existing
upload/import flow **is** the ingestion.

Core aggregates: **manga → chapters → chapter pages**; **users** (auth + OTP
email verification); **library / reading-status** per user.

> Placeholder — populated as the domain model is documented. Page processing and
> the email/OTP flow are detailed in the module docs.
