# ToastGeneric visual design surface spike

Environment: Windows 11 build 26200. Render path: Windows PowerShell 5.1 + Windows.UI.Notifications.ToastNotificationManager + registered `Toasty.CLI.Notification` AUMID. Test harness and generated assets are in this directory.

## Evidence

Rendered test cases:

- `01-logo-circle.xml` through `10-spinner-indeterminate.xml` were submitted by `render-toast-spike.ps1` and all rendered/submitted successfully.
- Additional edge cases: `11-unknown-spinner.xml` submitted but the unknown `<spinner/>` element produced no visible spinner; `12-local-custom-audio.xml` submitted, but local-file custom audio is not a useful visual capability and should not be relied on over `ms-winsoundevent` sounds.
- Notification Center screenshots showed the hero, appLogoOverride badge, progress bar, attribution row, and generated workstream badge images rendering on this machine.

## Capability matrix

| element | renders? | size/shape observed or constrained | usable for workstream-id or event-id encoding | notes |
|---|---:|---|---|---|
| `image placement="appLogoOverride" hint-crop="circle"` | Yes | Source PNGs at 256x256 rendered crisply as a small leading badge, roughly 32-48 effective px depending on toast surface/scaling. Circle crop masks corners. | Best primary workstream ID signal. | Generated `workstream-blue-ro-circle.png` with color + initials + faint glyph worked well. This is always near the title and survives compact display. Use simple high-contrast art; tiny details are lost. |
| `image placement="appLogoOverride" hint-crop="none"` | Yes | Same slot as circle, but square/uncropped. Corners are preserved. | Best when workstream identity uses a square tile, monogram, or shape. | Current toasty uses this slot but does not expose crop control or generated badges. |
| `image placement="hero"` | Yes | Full-width banner in the toast body. Recommended source ratio around 2:1; 728x360 source rendered cleanly. It consumes substantial vertical space in Notification Center and expanded/pop-up surfaces. | Strong event ID signal for high-severity/high-salience events. | Excellent for `blocked`, `build failed`, `approval needed`, etc. Not ideal for every routine toast because it pushes text/actions down and can dominate the card. |
| Inline body `<image src="..."/>` | Yes | Rendered below text, constrained to available content width. A 256x128 chip rendered as a horizontal event badge. | Good secondary event ID signal. | Better than hero for routine events. Use `hint-align`/groups when inside subgroups; top-level inline images stretch/fit according to renderer. |
| Top-level `<text>` | Yes | First text is title/bold; following text is body. Schema supports only 3 top-level text children; extra root text is dropped or de-prioritized. Long lines wrap/truncate based on available surface. | Text is necessary but weak for at-a-glance identity. | Use line 1 as event title, line 2 as concise details, line 3 sparingly. Do not depend on line 4+. |
| `<text placement="attribution">` | Yes | Small subtle row at bottom of toast content. | Good tertiary metadata: event class, repo, run id, age. | Useful for `event: build-failed` or `streamliner / renderer`. Not visually loud enough as primary identity. |
| `<actions><action .../></actions>` buttons | Yes | Up to 5 buttons/context-menu items combined by schema. Layout is compact; buttons appear under body when there is room/expanded. | Not a glance signal; interaction affordance. | Good for Open/Snooze/Done/Mute. Keep to 2-3 primary buttons; 5 is visually heavy. Activation was not tested here. |
| `<progress .../>` determinate | Yes | Desktop progress bar with title, percentage/value string, status. | Excellent event-state signal for running/waiting work. | Use for in-progress workstreams. `status` is required. Supports `value="0.0"` to `1.0`. |
| `<progress value="indeterminate" .../>` | Yes | Animated indeterminate bar, not a standalone spinner. | Good event-state signal for waiting/monitoring. | There is no supported ToastGeneric `<spinner/>` element. Use indeterminate progress instead. |
| Adaptive `<group><subgroup>` columns | Yes | Multiple narrow columns render as a small label grid. Text styles like `captionSubtle` and `base` work inside subgroups. | Strong compact dual/tri-signal layout: WORK / EVENT / AGE. | Best non-image way to pack two independent signals. Root text styling hints are limited; subgroup styling is where caption/base/title styles work. |
| `hint-style`, `hint-align`, `hint-wrap`, `hint-maxLines` | Partly | Supported inside adaptive groups/subgroups; root text only honors limited hints such as max lines. | Useful inside grid/chips. | Use subgroup caption labels with bold values. |
| Custom audio via `ms-winsoundevent:*` | Yes | Audible, no visual surface. | Event type can be encoded audibly, not visually. | Use sparingly. Available strings include Notification.Default, IM, Mail, Reminder, SMS, and looping alarm/call variants. |
| Custom local audio file | Submitted, not recommended | Visual toast rendered; audio behavior is app/package/version dependent. | No visual value. | Docs say custom file paths fall back to default sound in some cases. For Streamliner visual design, ignore. |
| Scenario (`reminder`, `alarm`, `incomingCall`) | Not deeply tested | Changes persistence/expanded behavior, not a new visual encoding surface. | Maybe for urgent/blocking events only. | Alarm/reminder can stay visible longer but are disruptive. Do not use as routine styling. |
| Header (`<header .../>`) | Not tested in harness | Groups notifications in Notification Center. | Useful for workstream grouping in history, not popup glance. | Requires stable ids/arguments; not primary visual design. |

## Layout recommendations

### 1. Default Streamliner toast: workstream badge + compact event state/progress

Use appLogoOverride for workstream identity, first text for event type, progress/attribution for event state. This is the best default because it remains compact and glanceable without consuming hero space.

```xml
<toast>
  <visual>
    <binding template="ToastGeneric">
      <image placement="appLogoOverride" hint-crop="circle" src="file:///C:/Users/robemanuele/proj/streamliner/streamliner-desktop-mvp/.paw/work/streamliner-desktop-mvp/spikes/toast-xml/images/workstream-blue-ro-circle.png"/>
      <text>Renderer workstream: implementation running</text>
      <text>Phase 3/5 - waiting on tests</text>
      <progress title="Implementation" value="0.62" valueStringOverride="62%" status="Phase 3/5"/>
      <text placement="attribution">event: in-progress - renderer</text>
    </binding>
  </visual>
</toast>
```

Best use: normal agent running/waiting/completed states. Workstream = logo color/initials/glyph; event = title + progress state + attribution.

### 2. High-salience toast: workstream badge + event hero banner

Use this when the event itself must dominate visually: blocked, build failed, approval required, production-impacting issue.

```xml
<toast>
  <visual>
    <binding template="ToastGeneric">
      <image placement="appLogoOverride" hint-crop="circle" src="file:///C:/Users/robemanuele/proj/streamliner/streamliner-desktop-mvp/.paw/work/streamliner-desktop-mvp/spikes/toast-xml/images/workstream-blue-ro-circle.png"/>
      <image placement="hero" src="file:///C:/Users/robemanuele/proj/streamliner/streamliner-desktop-mvp/.paw/work/streamliner-desktop-mvp/spikes/toast-xml/images/hero-build-failed.png"/>
      <text>Renderer workstream</text>
      <text>Build failed after 3 attempts.</text>
      <text placement="attribution">event: build-failed</text>
    </binding>
  </visual>
  <actions>
    <action content="Open" activationType="protocol" arguments="streamliner://open?workstream=renderer"/>
    <action content="Snooze" activationType="protocol" arguments="streamliner://snooze?workstream=renderer"/>
  </actions>
</toast>
```

Best use: urgent conditions where event type should be recognizable from peripheral vision. Avoid for routine updates because the hero image takes a lot of vertical space.

### 3. Dense glance toast: workstream badge + adaptive label grid + event chip

Use subgroup columns to pack two or three independent signals without a huge hero image.

```xml
<toast>
  <visual>
    <binding template="ToastGeneric">
      <image placement="appLogoOverride" hint-crop="none" src="file:///C:/Users/robemanuele/proj/streamliner/streamliner-desktop-mvp/.paw/work/streamliner-desktop-mvp/spikes/toast-xml/images/workstream-orange-api-square.png"/>
      <text>API workstream needs attention</text>
      <group>
        <subgroup hint-weight="1">
          <text hint-style="captionSubtle">WORK</text>
          <text hint-style="base">API</text>
        </subgroup>
        <subgroup hint-weight="1">
          <text hint-style="captionSubtle">EVENT</text>
          <text hint-style="base">BLOCKED</text>
        </subgroup>
        <subgroup hint-weight="1">
          <text hint-style="captionSubtle">AGE</text>
          <text hint-style="base">4m</text>
        </subgroup>
      </group>
      <image src="file:///C:/Users/robemanuele/proj/streamliner/streamliner-desktop-mvp/.paw/work/streamliner-desktop-mvp/spikes/toast-xml/images/event-blocked-red.png"/>
      <text placement="attribution">streamliner / api - event: blocked</text>
    </binding>
  </visual>
</toast>
```

Best use: dashboards/agent fleets where the user needs `which workstream`, `what event`, and `how stale` at once.

## Toasty's current limitations vs native ToastGeneric unlocks

Current toasty XML in `C:\Users\robemanuele\proj\util\toasty\main.cpp` is essentially:

```xml
<toast activationType="protocol" launch="toasty://focus">
  <visual>
    <binding template="ToastGeneric">
      <image placement="appLogoOverride" src="..."/>
      <text>title</text>
      <text>message</text>
    </binding>
  </visual>
</toast>
```

Limitations:

- Only one image slot is used, and it is treated as a generic icon rather than a generated workstream badge.
- No explicit `hint-crop` choice, so circle vs square badge design is not exposed.
- No hero image for high-salience event banners.
- No inline image/chip for event identity.
- No attribution row for subtle structured metadata.
- No adaptive groups/subgroups for label grids.
- No progress bar or indeterminate progress for long-running work.
- No buttons/actions in the visual design path, even though native ToastGeneric supports up to 5 buttons/context menu items combined.
- No exposed audio/scenario/header controls.

Native ToastGeneric unlocks a much richer visual language: color+initials/glyph workstream badge, event hero or event chip, structured label grid, progress state, attribution metadata, and action buttons.

## Caveats on this machine / Win11 build 26200

- PowerShell 7.6 could not load the WinRT toast type with the standard `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]` syntax. Windows PowerShell 5.1 (`powershell.exe`) worked reliably. The harness intentionally invokes Windows PowerShell.
- Rendering was reliable with the registered `Toasty.CLI.Notification` AUMID. Use a registered Start Menu shortcut/AUMID for reproducible rendering.
- File URI image sources rendered successfully in this desktop spike. For a packaged app, prefer `ms-appx`/`ms-appdata`; for unpackaged desktop, ensure stable accessible absolute paths or app data paths.
- The toast renderer is adaptive. Exact pixel dimensions vary with display scale, Notification Center vs popup surface, and Windows build. Design with padding, large glyphs, and high contrast rather than relying on pixel-perfect layout.
- Unknown elements such as `<spinner/>` do not create new UI. Use `<progress value="indeterminate" .../>` for spinner-like waiting state.
- Root-level text is limited. The current schema says only 3 top-level text elements are supported; styles mostly apply inside adaptive subgroups.

## Reproduction

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\robemanuele\proj\streamliner\streamliner-desktop-mvp\.paw\work\streamliner-desktop-mvp\spikes\toast-xml\render-toast-spike.ps1" -Aumid "Toasty.CLI.Notification" -DelayMs 900
```

Open Notification Center with Win+N to inspect queued notifications.
