# RadioTEDU OnAir Service Host

`RadioTEDU-OnAir-ServiceHost.exe` is a repository-owned Windows SCM host for one service name and one pipe-delimited `.services` configuration.

The host accepts exactly:

```text
--service-name RadioTEDU.Example --config C:\ProgramData\RadioTEDU\OnAir\Services\RadioTEDU.Example.services
```

Each non-comment configuration line is compatible with the legacy five-field shape:

```text
id|executable-path|arguments|working-directory|restart-on-exit
```

Every valid row starts once. `restart-on-exit=true` restarts an exited child with a 1s-to-60s bounded exponential backoff; `false` leaves that child reported as `Exited`. The host kills entire child process trees on SCM stop and writes only redacted logs. It exposes a secret-free state snapshot at:

```text
C:\ProgramData\RadioTEDU\OnAir\State\ServiceHost\service-host-<service-name>.json
```

This package does not create, replace, stop, or reconfigure a Windows service. Registering a replacement service must be a separately approved, post-health-check migration step.

Arguments are fail-closed: inline `token`, `password`, `secret`, or `api-key` flags (including a following value), and URLs containing userinfo are rejected without repeating the argument. Use secret-free arguments and a separately protected configuration-file reference. Providing secrets to the child remains an explicit deployment prerequisite outside this host configuration.

The installer disables ACL inheritance on `Services`, `State\ServiceHost`, and `Logs\ServiceHost`, then grants full control only to LocalSystem and built-in Administrators by well-known SID. Ordinary OnAir media, data, logs, and state retain their existing permissions.
