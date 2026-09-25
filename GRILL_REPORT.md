# GitHub TUI — Grill Report: Gaps, Incomplete Logics, Bugs

> Date: 2026-09-25
> Version audited: 0.8.1 (`package.json:3`, `CHANGELOG:5`, `VISION:5`)
> Scope: whole app (`app.mjs`, `tui/*.mjs`, `tui/tabs/*.mjs`, `tools/`, `tests/`)
> Method: static audit + plan-vs-code diff (`VISION.md`, `LOCAL_GIT_PLAN.md`) + key/mouse/render dispatch trace + error/offline/shutdown trace
> Skill note: `grill-me` loaded, `grilling` skill id not found (`Available: customize-opencode, find-skills, grill-me, security-audit`). Fell back to manual grill.

---

## 0. Self-breaking / data-corruption (fix first)

### 0.1 Portability export→import self-fails
- `tui/portability.mjs:24-28` `SESSION_KEYS` omits `localAutoPoll` persisted at `tui/state.mjs:1284`.
- `validatePortableConfig:83-89` rejects bundles `buildPortableConfig:49` just produced when on-disk session contains that key.
- CLI: `app.mjs:128-139` `export --format markdown` writes counts only; `import:141-147` never forwards `{merge}` so replace mode unreachable from CLI.

### 0.2 `addInboxFilter` return-type corruption
- `tui/store.mjs:146-157` `list.slice(0,30)` silently drops oldest; `return {...saved,truncated:true}` where `saved` is array spreads indices into object `{0:…,truncated:true}`.

### 0.3 Cache accounting / perf
- `tui/github.mjs:211-225` `evictLRU()` only on insert with `etag` (`:535-539`). Non-etag GETs never cached yet `recordSync(now)` (`:541`) claims “Last synced”.
- `tui/github.mjs:253-260` `lastSynced` map unbounded — no eviction.
- `tui/github.mjs:158-184` `loadEtagCache()` filters by TTL but never enforces `ETAG_CACHE_MAX=500` after load.
- `tui/github.mjs:313-330` `getCacheStats()` `JSON.stringify`s every body; called from header render path — O(total-bytes) per frame.
- `tui/github.mjs:203-208` `_cacheFlushTimer` `unref`d but never cleared; no shutdown-callback (relies on `process.on('exit':278-281)`).
- `tui/github.mjs:370-377` offline serve returns any-age, no TTL; `:384` low-rate, `:492` 304 correctly require `Date.now()-ts<ETAG_TTL`; `:406-413` timeout fallback, `:568-575` error fallback also any-age — inconsistent contract.
- Every read bumps `lastAccess` + `_cacheDirty=true` (`:373,385,409,493,571`) so 60s flush rewrites disk on read-only sessions.
- `tui/github.mjs:748-834` `downloadToFile` no size cap vs `fetchTextUrl:840,872` 2MB cap with `truncated` flag — unbounded disk write.

### 0.4 Portable-home split
- `tui/state.mjs:1187-1189` honors `GITHUB_TUI_HOME`, but `tui/config.mjs:31-39` (`CONFIG_DIR`, `ETAG_CACHE_FILE`, `LAST_SYNCED_FILE`, token/bookmarks) uses `homedir()` unconditionally.

---

## 1. Auth / rate-limit / offline

### 1.1 Token 401 handling inconsistent
Full wipe (`resetAccountState()+resetRateLimit()+removeToken()`) only in:
- `app.mjs:108-115` 60s poll
- `tui/tabs/repos.mjs:127-132` `loadUserData`, `:234-246` `_recover401`
- `tui/tabs/analyze.mjs:330-335` (plain `showMessage`, no retry handler vs repos `setTab(6)+showError(retry)`)

Missing / degraded (stale token, stale header, stale `lastScopes`):
- `tui/tabs/dashboard.mjs:199-200` generic `showError({retry})`, `:77-88` `Promise.allSettled` counts + `console.error` under DEBUG — 401 looks like “N widgets failed”
- `tui/tabs/dashboard.mjs:224-225`, `tui/tabs/inbox.mjs:87-89,115-116`, `tui/tabs/actions.mjs:408-409,426-431,344-351` (`probeFailures++` — 401 indistinguishable from “no failures”), `tui/tabs/detail.mjs` (no 401 branch), `analyze-search.mjs:112,138`, `analyze-traffic.mjs:37`, `analyze-security.mjs:24` (formats `': sign in again'` string only)
- `tui/state.mjs:83-229` `resetAccountState()` does not clear `github.mjs` `lastScopes`; only `resetRateLimit()` (`github.mjs:90-97`) does — any path forgetting `resetRateLimit()` leaves stale scopes in Settings.

### 1.2 Rate-limit resync
- `tui/github.mjs:49-85` monotonic-down same-window, `:114-124` window-guarded overwrite, `:459-470` excludes `/rate_limit` — design sound, edges broken:
- `:520` `if (res.statusCode===403 && rrParsed===0)` misses secondary/abuse 403s and missing headers (`NaN===0` false).
- `:59-61` `clampRemaining` against stale `effectiveLimit` when `limOk` false; after account switch without reset, valid `remaining` clamped to old limit.
- `app.mjs:91-103` poll `getRateLimit(token)` no `signal`, no epoch guard — slow poll after logout/login can resync new account mirror.
- `github.mjs:115-119` poll with missing `reset` still overwrites `limit/remaining` leaving old `reset` — mixed-window counter.

### 1.3 Pagination truncation
- `app.mjs:152` CLI `repos` single `getUserRepositories(token,1,100)` — >100 silently truncated. `:154` inbox single 100; `--unread` filters client-side — unread beyond 100 invisible. `:157-166` actions scans first 20 repos ×10 runs, per-repo `catch{}` — partial failure == clean.
- `tui/tabs/repos.mjs:146,216-224` `MAX_PAGES=1000` flips `hasMore=false+_moreReposAvailable=true` + toast; `loadMoreRepos:249` then refuses until palette re-entry — confusing gate.
- Dashboard widgets single-page (trending 30, starred 100, issues/PRs 10, followers 10, notifications 50). Starred cap `page>6` (`dashboard.mjs:219-222`), heatmap 3×100 (`:237-238`) understates — labeled public-only, acceptable but note.

### 1.4 Empty states
No fabricated repos/users — `emptyState()` consistent (`repos.mjs:406,536`, `inbox.mjs:462,476,498`, `actions.mjs:724,774,808,847`, `dashboard.mjs:721`, `analyze-search.mjs:546,587,624,662`, `local.mjs:1642,1659`, `render.mjs:265`). Watch:
- Cached offline/timeout/error fallbacks (`github.mjs:376,412,574`) resolve cached body with age preserved but UI shows no per-pane staleness chip beyond global banner — misread as live.
- `security-aggregate.mjs:93` “No open alerts (or denied access)” conflates empty vs permission-denied; `analyze-traffic.mjs:74`, `analyze-security.mjs:287,317` similar hide 401/403.

---

## 2. Local Git vs LOCAL_GIT_PLAN.md

### 2.1 Numbering / stale docs
- Plan: `7th tab Local key 7 TABS[6] TAB_CONTENT_Y[6] case 6`. Shipped: `state.mjs:338 {key:'6',label:'Local'}`, `render.mjs:209 5:Local`, `keys.mjs:612 case 1-6`, `keys.mjs:49 tabModules[5]=local`, `help.mjs:156 6 Go to Local`, `local.mjs:1647 Press [0-6]`.
- `local.mjs:3` header “Phase 0/1 READ-ONLY…coming soon” false — `fetchFlow:738`, `pullFlow:763`, `pushFlow:832`, `toggleStage:922`, `discardFlow:1043`, `commitFlow:1347`, picker `1119+` shipped.

### 2.2 Phase 0 foundation
- `runGit` OK `utils.mjs:648-720` (`GIT_TERMINAL_PROMPT=0`, 30s/120s, SIGTERM→SIGKILL, 4MB cap).
- `getLocalGitMeta` OK `git-context.mjs:22-76` but relative `--git-dir` resolved vs `process.cwd():37` — fragile if cwd changes. Boot hoist `app.mjs:342-367` outside token gate OK.
- Old-git drift: plan requires `git --version` probe once; code has per-call `isUnknownOption():918-920` + fallbacks `951-956,1025-1028,1084-1087` — works, spec drift.
- `rev-list --left-right --count HEAD...@{u}` missing everywhere; `local.mjs:282-284` uses porcelain `-b` header only.
- `index.lock → setRetryHandler` missing; `local.mjs:910-913` toasts only, `state.mjs:837` never called from local.
- `git-local.mjs:294-296 headSubjectArgs()` dead (amend uses `localHistory[0]` `local.mjs:1364-1366`).

### 2.3 Phase 1 monitor/diff
- Poll-only correct, no `fs.watch` (deferred): `local.mjs:510-534` 1500ms on-tab / ~6s off, skip on `loading/inputMode/confirmAction`. Missing §11 250ms debounce after manual actions.
- Sections `1541-1542` `local:conflicted/staged/unstaged/untracked/commits` — plan also requires `local:branch`; `getCurrentSection:1545-1550` never returns branch.
- Empty-repo over-broad `321-329` any `code!==0` → `[]` — doesn’t distinguish `128 does not have any commits` vs corrupt-repo.
- Untracked-dir discard `1079` `clean -f` without `-d` fails on dirs (inherited from plan argv).
- Binary/large OK: `MAX_VIEW_BYTES=1M:35`, NUL+size guards `374,382-384,420-425,480-483`, 12KB cap `482-483`, 200-row cap `1869`, symlink-escape refused `400-418,365-370`. CRLF only via `\r?\n` — no explicit test. Local NUL check duplicates `files.mjs:97 isProbablyBinary` instead of reuse.

### 2.4 Phase 2 stage/discard/commit
- `toggleStage:922-945` OK + silently marks conflicted resolved, no “mark resolved” warning. `stageAll:969-998` toggles to unstage-all when only index dirty (extra vs plan, tested `local-gaps.test.mjs:176`).
- Discard double-`confirmDanger:1043-1070` OK but no diff-stat `+a -b` / size in popup; staged `1047-1050` + conflicted `1051-1054` blocked (safer than plan `restore --source=HEAD --staged --worktree`, deviation).
- Commit two-prompt `1347-1433` OK, caps `500/4000:1323-1324`, `classifyCommitError:1329-1345`, respects `commit.gpgsign`. Gaps: no `op-state` guard in commit/amend; no detached-HEAD guard (only `syncBlocked:723-736` for pull/push); amend prefill stale if history not refreshed.

### 2.5 Phase 3 sync/branches
- Fetch direct `738-761` OK; pull dirty-confirm vs clean-direct `763-781` — plan says clean pull is popup (deviation, tested `local-sync.test.mjs:150`).
- Push fast-path direct `832-857` — plan says normal popup; only pops on no-upstream/behind. Lease double-`confirmDanger:870-881` OK, never `--force`, but step-1 lacks server reason + `behind N`.
- `resolvePushRemote:817-830` sync `execFileSync git remote` (not `runGit`, no abort/env), falls back to `origin` with no “no remotes” hint.
- `checkoutSelectedBranch:1170-1193` checks `localConflicted` only, not `localOpState`; dirty-check counts untracked `1184-1185` (over-warns); `shortBranchName:1165-1168` + `checkout <name>` relies on auto-track, no `--track`.
- Create `1220-1241` (`check-ref-format` without `--`, 200 cap `1228`) / delete `-d`→`-D:1289-1305` OK; `n/d` outside picker warn `1222,1274` so `n` dead outside picker+diff (`keys:1510-1519`).

### 2.6 Phase 4 polish
- Confirm upgrade done `render.mjs:887-968` (paragraphs, dynamic `928`, danger `936,942`, `[Yes]/[Cancel]:958-961`, hint `963`), danger Enter-noop `keys.mjs:559-`, mouse Yes/Cancel `mouse.mjs:554`. Doc gap `help.mjs:185-188` still says `y/Y/Enter` confirms.
- Theme tokens present `theme.mjs:142-154,237-249` but `gitActionBar/gitFocusRing` never used in `local.mjs`.
- Mouse partial vs §6.7: have `_localBounds:1794-1807`, click `1036-1072`, branch rows, diff toggle/fullscreen `1052-1054`, fold `1057-1060`, wheel `1678-1686,1597`, dblclick `701-726,1308-1332`, collapsible via `_sectionHeaders`. Missing: action-bar buttons, pill→fetch, chip→picker. Hover moves selection `mouse.mjs:1022-1030` — plan says click-only.
- Footer `render.mjs:713` omits `A/C/n/N/z/y/o/r/g/G/Space`. `LOCAL_OWNED:keys.mjs:56` adds `F,g,G,z` beyond plan set — `g/G/z` bypass generic handlers, rely on `local.keys` equivalents (passes ownership test, arch drift). `Z` not owned (global collapse wins — intentional).
- Palette `keys.mjs:1269-1290` missing `local.unstageAll/openCommit`; extra `local.fullscreen`.
- `focus.mjs:116-119` zones OK; `custom-keys.mjs:21` lacks `local`; no `localAutoPoll` toggle UI (persist `state.mjs:1284,1309` only); `resetAccountState:83-` preserves local correct; `recoverScrollPositions:render.mjs:132-141`, `breadcrumb:255-258`, `viewKey+=branch:784`, `TAB_CONTENT_Y[5]:209`, compact `720`/linear `735-763` done.
- Boot OK but `localAhead/Behind/OpState` not seeded until first `refreshLocal`.

### 2.7 Deferred correctly absent (not bugs)
Hunk staging, `fs.watch`, `$EDITOR`/body widget (two-prompt only), stash/rebase manager, `rebase --continue/abort`, cherry-pick/bisect, submodules/worktrees beyond `gitDir`, SSH/credential UI (only `gitAuthHint:719-721`), merge tool.

### 2.8 Tests
Local suites 62+58 pass, 0 fail/skipped. No `skip/todo` in `local-*.test.mjs` / `git-local.test.mjs`. Gaps vs plan §8/§12: no exact `keyboard-local` file (ownership covers), no mocked old-git `restore→reset` unit, no empty-repo/no-remotes/detached-commit/op-state-commit/`index.lock`/CRLF/10k/SSH-no-creds/worktree matrix tests. Name drift: expected `local-git-integration, keyboard-local, local-style-mouse` vs actual `local-confirm,gaps,mouse,stat,sync,shortcut-ownership`.

---

## 3. Keys / mouse / render

### 3.1 `state.mjs` TABS
- `state.mjs:317-345`: `1:Dash 2:Repos 3:Explore 4:Actions 5:Inbox 6:Local 0:Settings`, `tabState.current:346`, `setTab:348-353` no `focus` touch. Only number/Tab paths call `resetFocus()`.

### 3.2 Number / Tab
- `keys.mjs:603-640`: `0→6` OK, `1..6` OK + security-pane dispatch. `7` dead. `analyze.keys['1'..'6']:972-977` dead outside security pane.
- `Tab:660-683` + `focus.mjs:79-123,128,164-208,201-208,217-262`: `Tab` on `1..6` switches tab, never `focusNext()` — zones unreachable. `syncDashboardFocus` only `tab==0`; `getFocusedSelection` null for `2,5,6`. Dashboard double-handle `885-897` unreachable. Palette `tab.*:1223-1229`, mouse `handleTabClick:890-903`, dblclick `755,765,783` call `setTab` without `resetFocus` — desync.

### 3.3 Missing `case 6`
- `handleSpace:961-969`, `handlePageUp:970-978`, `handlePageDown:979-987` `0..5` only — `6:Settings` swallowed dead (`keys.mjs:757-759`).
- `handleTop:988-1027` `0..6` OK; `handleBottom:1028-1080` `6` explicit no-op; `handleEnter:1124-1137`, `handleUp:1138-1154`, `handleDown:1155-1169` OK; `handleBack:1170-1210` `6` falls to `setTab(0)` — Esc on Settings jumps to Dashboard.
- `getCurrentSection/getTabSections:1100-1122` `0..6` OK.

### 3.4 LOCAL_OWNED / which-key
- `keys.mjs:56,414-422` before which-key: `['a','A','X','c','C','f','F','p','P','B','b','y','o','[',']','g','G','z']`. `local.keys:1496-1539` has `\r,\n,F,a,A,X,c,C,f,p,P,B,b,n,N,z,d,[,],y,o,r,g,G,space`.
- Stale comment `local.mjs:1537-1538` “no z/Z” false — `z:1521-1527` exists, `Z` absent (global wins, intentional).
- Over-owned `a,A,C,f,F,p,P` harmless (no global collision now, only `g` prefix remains `which-key.mjs:18-31`); masks future globals.
- Single `g` dead everywhere except Local (prefix check `keys.mjs:436-440` + `isPrefixKey:199-200` before `case 'g':760`). `G` single-press works except files `ghClone` + Inbox grouping.

### 3.5 Hijacked / dead keys
- `l:907-914` before per-tab kills `repos.keys.l:923-935` (palette-only). `s:857-866` kills `repos.keys.s:946`. `S:869-875` kills `settings.keys.S:566` (same effect, redundant). `r:688-713` kills `local.keys.r` / `settings.keys.r:561-564` (divergent `refreshCurrent t==5→refreshLocal:309-312` vs `loadUserData`). `u:823-838` yields correctly to `analyze/repo/inbox u`, else `undo()`. `o/y/b/B:714-751` files-pane dispatches shadow per-tab (intentional). `z/Z/X:784-822` Inbox/files/Actions-runs beat collapse (correct, Local `z` owned). `Ctrl-A:917-940` falls through when not in mode. `H/L:886-887` Dashboard-only correct.
- Detail popup `582-597` swallows any key not in `detail.keys:695-768`. Help `507-549` `q` hijacked to close (intentional), other printables append to `helpQuery`. Custom keys `957-959` after per-tab — colliding custom binding dead. `custom-keys.mjs:22` `VALID_CONTEXTS=[any,detail,repo,dashboard,files]` — missing `local/inbox/actions/settings` (must use `any`, over-fires); `validateBinding:24-46` single-char only.

### 3.6 Mouse
- `_localBounds` published `local.mjs:1794-1807`, nulled `1641,1658`, consumed `mouse.mjs:1006-1010,1012-1034,1036-1072,1677-1698,1308-1337`. `state.mjs:628` type comment outdated.
- Hover `264-406`: missing Explore, Settings, detail, help/bookmarks/quickSettings/confirm, dashboard attention/activity/issues/prs/custom/contrib (only trending/top/stale).
- Wheel `408-410→1592-1673`: Explore `1611-1612` only `detailsScroll` — ignores search/user/code/forks/file/readme; missing Settings/detail/help/palette/confirm.
- Click `412-429`: overlay first `435-443`, detail `584-660`, tab bar `662-666`, pane tabs `668-672`, security subtabs `675-689`, collapsible `692`. Geometry hardcodes (`1242,1251,330,1405,1477`) vs `TAB_CONTENT_Y` — hover vs click diverge on Repos density.
- Dblclick gate `701-716` only `0,1,5`; `handleDblClick:722-886` Local/Repos/Dashboard only — Inbox/Actions/Explore/Settings no parity (Actions has separate single-click-double `_actionsClickedIndex:1532-1544,1556-1572`).
- Confirm `_clickConfirm:542-568` via `_confirmBounds:render.mjs:958-961` `Yes` fires even in danger mode (by design, no second confirm) vs keyboard `Enter`-noop `keys.mjs:559-574`.

### 3.7 Render
- `TAB_CONTENT_Y:203-211` all `6` — not per-tab truth, mouse compensates inline.
- `breadcrumb:217-262,479-483` missing `packages/traffic/checks/security/compare/overview`, `actions failures`, `searchType`, `inboxTextFilter`, `localFocus/diff`; narrow truncates left, can push repo name off.
- `statusLine:673-717,646-652` incomplete vs actual keys; `5` typo `[[ / ]] Focus`; confirm `674` shows `[y]/[n]` even in danger (hint only in dialog `963`).
- `viewKey:783-784` `tab|analyzeView|detailsPane|actionsView|localBranch` — missing `reposView,inboxFilter,securitySubPane,detailsTab,filesPath,fileViewing,showDetail,dashboardFocus,localFocus/localDiff` — stale wide-glyph cells.
- Confirm dialog `887-968`: unbreakable token sliced `917`, `…` beyond `maxLines:927` off-by-one.
- `compact:719-732` (guard `790-801`) order implies `0..6` numeric vs `1..6,0`. `linear:734-768` (guard `790-794`) `H==10` overlap line `8==footer:765-766`; missing local diff, actions failures, security, custom beyond counts.

### 3.8 Session / focus / quick-settings
- Saved `state.mjs:1264-1290`: `tab,recentRepos,analyzeView,searchQuery,searchType,reposView,autoRefresh*,inboxTextFilter,lastSeenVersion,localAutoPoll`. Not saved: `localFocus/selection`, `securitySubPane/detailsPane/filesPath/settingsCursor/repoSort`, etc. (dashboard/collapsed separate files `1241-1257,1191-1207`). Load `1292-1311` validates `tab:1297`, `analyzeView` only if `search:1301`, no `resetFocus`.
- `quick-settings.mjs:11-116,126-137,183-227,229-286` index 10 no number shortcut (intentional `213-215`), `return true:226` swallows all other keys (modal), value overlap on narrow `boxW=min(50,W-4)`.

---

## 4. Git safety / hangs / shutdown / logging

### 4.1 Argv safe, residuals
Safe argv throughout (`git-context.mjs:11`, `utils.mjs:656`, `local.mjs:256-258,318,447,461,468,745,789,865,934,951,954,1005,1023,1026,1079,1082,1085,1124,1200,1233,1252,1294,1442` with `--`, `check-ref-format:1233`, `keychain.mjs:130,139,149,162,171,181`).
- `detail.mjs:743,745` trailing `--` no-op in those positions (harmless, `prNum` validated `:741-742`); `opts:731` lacks `cwd` — correct only because `:722-726` gates on `localRepo` match.
- `keychain.mjs:215-219` Windows `'/pass:'+t` puts PAT in argv (OS-tool constraint). `:231-234` PS interpolation safe (constant + escaping). `:264` `sh -c` constants only.
- `custom-keys.mjs:211` `spawn(shell:true)` + `shellEscape()` — user-config exec by design.

### 4.2 `GIT_TERMINAL_PROMPT` / timeouts
Has it `utils.mjs:652` + timeout + abort-kill `:665-693`. Missing:
- `detail.mjs:731` `spawnSync(gh/git,30s)` no env, no cwd, blocks loop.
- `local.mjs:819-824` sync `execFileSync git remote 8s` no env.
- `git-context.mjs:10-17` no env/abort; sync 5s boot block.
- `utils.mjs:612-638` `runCommand/Capture` no timeout/kill/env/abort.
- `github.mjs:358,398` 15s + AbortSignal good but timer not `unref`d; `downloadToFile:748-834` no timeout/signal (redirect cap 5 only); `fetchTextUrl:840-881` signal but no timeout. Mutation APIs (`markRead/markAll/unsubscribe:632-640`, `star:658-668`, `rerun/cancel/dispatch:699-713`, `comment/react/close/reopen/merge/review/update:903-929`, `subscription/issue/release:1030-1057`, `dependabot:975,977`) no signal.
- `utils.mjs:690` SIGKILL `setTimeout 2000` not `unref`d.

### 4.3 Shutdown leaks
`app.mjs:311-328` clears intervals, runs callbacks, restores raw/mouse/paste — gaps:
- `app.mjs:227-232` `typeof messageTimer==='number'` dead (Node timers objects) — legacy `state.mjs:803-804` never cleared.
- `toast.mjs:48-51` per-toast timeout never tracked/unref’d — fires into dead screen.
- `which-key.mjs:65-66,82`, `state.mjs:1069-1074` 50ms confirm poll, `state.mjs:1316-1320` session-save timer leak.
- `github.mjs:398` timer + in-flight sockets not aborted (no `invalidateAccountAsync` in shutdown).
- `app.mjs:417-424` `uncaughtException` without `shutdown()` — raw/mouse/paste left on; `414-416` `unhandledRejection` only `debug()`.
- stdin `error/end:264-275` + `exit:326` double-exit race (guarded by `_shuttingDown`, OK). Local poller `local.mjs:533 unref + 536-538` registered `app.mjs:366` OK.

### 4.4 Logging
- Gates inconsistent: `app.mjs:38`, `keychain.mjs:275` `DEBUG||GITHUB_TUI_DEBUG`; `debug.mjs:15` only `GITHUB_TUI_DEBUG`; `dashboard.mjs:83,186` inline check.
- All append `~/.github-tui/debug.log` via `homedir()` ignoring `GITHUB_TUI_HOME`, never rotated — unbounded. `dashboard.mjs:84,187` `console.error` to stderr corrupts TUI. Crash handlers only log when DEBUG — default crashes traceless.
- Empty `catch{}` ~40x mostly benign (`chmod/unlink/mkdir`); risky swallows: `state.mjs:73,1198,1206,1249,1256,1289,1310`, `config.mjs:81,84,89,101,112,119,135,161`, `github.mjs:196,318,402,436,551,765,772,876`, `utils.mjs:415,664,678`, `undo.mjs:136`, `inbox.mjs:39,43`, `settings.mjs:351,522`, `local.mjs:828`, `repos.mjs:761`, `portability.mjs:36,101,113,169`, `profiles.mjs:31,44`, `keychain.mjs:278,283`, `theme.mjs:289`, `screen.mjs:38,343`, `keys.mjs:352`, `render.mjs:155`. `analyze.mjs:271 safe=p=>p.catch(()=>null)`, `analyze-search.mjs:189,403,416` silent nulls.

---

## 5. TODOs / stubs / help / palette

- Grep `TODO|FIXME|XXX|HACK|TBD|STUB|NotImplemented` clean — only `files.mjs:1383` highlighter regex, `local.mjs:3` stale header, `which-key.mjs:10-17` deleted stubs doc, `render.mjs:307,311` / `git-local.mjs:151` / `custom-keys.mjs:11,70,184,193` UI placeholders.
- No `run:()=>null` left; `~100+ palette.register` have real handlers (`palette.mjs:33-42`, `keys.mjs:1220-1615`). Degraded-only: `plugins.scan:1474` read-only `discoverPlugins()`, `smart.insight:1476` rule-based `buildSmartInsight()` only.
- `help.mjs:358 keys={}` empty stub (relies on global `?/Esc`). `getHelpLines:294 TAB_CATS=[dashboard,repos,analyze,actions,inbox,local,settings]` — `files/security/detail` fall back to `GLOBAL` first, not context-aware. `LOCAL:174 z/Z/X*` conflates collapse vs discard; `ACTIONS:104 Enter: View runs/open in browser` conflates expand vs `o`.
- `check-imports.mjs:23` `state.mjs` placeholder `noop` to break cycle (intentional). `tools/check-imports.mjs` run → `60 files, 0 issues`, but `AUDIT_MODULES:25-28` only `state.mjs+render.mjs`; alias tracking `:127-128,143-146` can mask false negatives. Docstring “58 files” (`CHANGELOG:67`) vs 60.
- Palette missing VISION actions: `Reload plugins/Hot-Reload`, `AI review/summarise (a)`, `r release`, `Since I was last here (R4)`, `Backup/restore`, `gh import`, `Multi-account Ctrl-A`.
- `recommended-features.mjs:5-11` `FEATURE_IDS=[focus-mode/smart-assistance/plugins/cli-export]` but only pure helpers: `validatePluginManifest:228` + `plugins.mjs:11 discoverPlugins()` validation-only (no runtime/workers/`onLoad/renderTab/onKey`/hot-reload/SDK). Missing: Duplicate/Priority, Complexity/Tech-Debt/Doc-Coverage, Review Prioritizer/Batching.

---

## 6. Roadmap / docs drift (referenced but missing)

- `VISION:108,110` Topic facets + `searchCode` still open. `:91` Runner utilization deferred (no API). `:75` prefetch deferred as unnecessary.
- `v0.9:116-124` OAuth device-flow (only PAT+gh CLI in `settings.mjs`), scope auditor (display only). `v1.0:128-136` Homebrew/Scoop/AUR/Nix, `pkg` binary, Demo GIF — none.
- `v1.x:144-171` all Smart Helpers missing except rule-based insight. `v2.x:179-228` Changelog, full Release Assistant (only draft/publish/edit `release-actions.mjs:23,64,85`), Branch Protection Visualizer (raw API only `analyze-security.mjs`), Review/AI/Dependency/Perf, Plugin Runtime/SDK/Themes-as-Plugins, Backup/gh-import/Team Sync (only export/import `portability.mjs:120,126`), Session/tmux/Multi-Pane/CLI Composition.
- Recipes `274-302` R4/R7/R8/R9 none.
- README staleness: themes 10 vs 2, tests 329 vs 416+/501, System 0.7.4 vs 0.8.1, layout omits `which-key/quick-settings/custom-sections/issue-create/git-context`, milestones/labels listed but removed `v0.7.1:454`.
- Version OK: `package.json 0.8.1 = CHANGELOG[0.8.1]-2026-09-25 = VISION v0.8.1`; `config.mjs:29` dynamic single-source. Drift only: `VISION:50` 416+ vs `CHANGELOG:31` 501.

---

## 7. Suggested fix order

1. §0 corruption + §4.3 shutdown (`portability SESSION_KEYS`, `store` return, `messageTimer` type, `uncaughtException→shutdown`, toast/confirm/session timers).
2. §1 auth/rate-limit (unify 401 wipe + `resetRateLimit`, fix 403 secondary, poll epoch guard, offline TTL contract, `GITHUB_TUI_HOME` for config/cache).
3. §2 Local guards (`rev-list` vs `-b`, `op-state`/detached commit guards, `clean -fd` for dirs, `runGit` for `remote`, `--track`, `local:branch` section, footer/palette completion).
4. §3 keys/mouse/render (`Space/PgUp/PgDn/Back-6`, `g` single-press, `l/s/r` divergence docs, hover-click parity, action-bar/pill/chip clicks, `viewKey` + breadcrumb + `statusLine` completion).
5. §5-6 docs/help/palette (themes/tests counts, `help` danger note, missing palette ids, VISION open-item honesty).

