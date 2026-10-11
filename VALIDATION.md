# Validation record

Verified locally on 11 October 2026:

| Check | Result |
|---|---|
| Strict TypeScript compilation | Passed |
| Automated tests on Linux host, Node 24.21.0 | 27 passed |
| Automated tests inside the Linux Docker build | 27 passed |
| Docker production image build | Passed; tagged `wardogs-session-bot:local` locally |
| Docker Compose configuration | Parsed successfully without loading a credentials file |
| Production container runtime | Node 24.21.0, non-root UID 1000 |
| Container SQLite write and consistent backup | Passed |
| Container publication/expiration lifecycle with mocked transport | Passed |
| npm dependency audit | Zero reported vulnerabilities at verification time |

The production image uses a digest-pinned Node base. The source archive includes the lockfile, TypeScript source, tests, deployment files, and documentation; generated dependencies, databases, and secrets are excluded.

**Not performed:** bot login, authenticated Discord REST calls, command registration into a real guild, desktop/mobile Discord rendering, and a real two-hour pilot session. No bot token or test-guild credentials were configured. These remain in `LIVE-TEST.md` and must pass before calling the deployment live-validated.

No WARDOGS API requests are made. Member-entered information is not a verified report of in-game state.
