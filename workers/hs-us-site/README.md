# hs-us-site

The U.S. site of HORIZON SHIELD, served at https://horizonshield.dev/ from `public/` (static files only).
The Japanese site is a separate site on shield.the-horizons-innovation.com and shares no pages with this one.

Deploy (TOshi): `cd ~/horizon-shield/workers/hs-us-site && npx wrangler@4.149.0 deploy`
The first deploy creates the DNS record for the apex of horizonshield.dev (custom_domain: true).
