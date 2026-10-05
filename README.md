# Demo Day Voting

Demo Day voting app and configuration for the existing Vercel project.

The live voting backend currently runs on the VPS:

- Voting: https://demo-day-votes.vercel.app/?public=1
- Admin: https://demo-day-votes.vercel.app/admin
- HTTPS origin: https://194-87-103-89.sslip.io

Vercel forwards requests to the VPS over HTTPS. The Node.js server and persistent
JSON database run on the VPS, not in Vercel Functions. Source code, tests and
deployment documentation are in `source/`. Database files and passwords are not
stored in this repository. Updating `source/` alone does not update the VPS:
deploy the server release first, then publish the Vercel configuration.

## GitHub Pages setup

In GitHub:

1. Open `Settings`.
2. Open `Pages`.
3. In `Build and deployment`, set `Source` to `Deploy from a branch`.
4. Select branch `main`.
5. Select folder `/docs`.
6. Save.

The Pages URL will be:

`https://zakharovleonid5.github.io/demo-day-voting/`

