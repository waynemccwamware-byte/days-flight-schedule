# Day's Flight Schedule: a new day with ETE and fuel from ForeFlight

Reference for Claude, written by the app's author (Wayne McClelland, GeezerGeek Pilot). A pilot pressed "Get ETE & fuel from ForeFlight (via Claude)" in the Day's Flight Schedule app (https://days-flight-schedule.netlify.app/). The job: plan a new flying day by getting each leg's ETE and fuel from their ForeFlight account, then reply with one link that opens the app with that day filled in.

## 1. ForeFlight connector

This needs the **ForeFlight Mobile** connector, from Claude's connector directory: https://claude.ai/customize/connectors/id/foreflight-mobile?q=foreflight (click Connect, then sign in to ForeFlight). Per ForeFlight, it is an open preview for subscribers with an active individual plan (Starter, Essential or Premium).

If the ForeFlight tools are not available in this chat, say so, give the pilot that link, and ask them to come back to this chat once it is connected (they may need to turn it on for the chat with the + button beside the message box). Do not estimate ETEs or fuel without ForeFlight.

## 2. Ask before running (one message)

- **Airports in order, on one line**, separated by spaces: e.g. `KSBA KSDM MMSF MMLT` is 3 legs. 2 to 6 airports (1 to 5 legs; the app holds at most 5).
- **Date** of the flight (ForeFlight uses it for winds; the app uses it for each airport's time zone and daylight saving). The pilot's message gives the date on the app's screen; use it unless they give another.
- **Wheels Up 1** time, local at the first airport. The pilot's message gives a default (their last wheels-up time, or 08:00); use it unless they give another.
- **Aircraft**: list their ForeFlight aircraft (`list_aircraft`) and ask which, defaulting to the primary.
- **Performance profile** for that aircraft (default: the aircraft's default profile) and **cruise altitude** (default: ForeFlight's choice).
- Optional: flight rules (IFR/VFR), a route per leg (default direct), and turnaround time at each stop (app default 0:45).

## 3. Run each leg

Call `calculate_route_performance` once per leg with `flight: {from, to}`, the chosen aircraft and profile, altitude/rules/route if given, and `departure_time` as an ISO 8601 instant with offset:
- Leg 1 departs at Wheels Up 1 on the date, local time at the first airport (ForeFlight's airport data gives `timezone_id`).
- Leg k+1 departs at leg k's departure + leg k's ETE + 0:05 pattern/approach (the app's default) + the turnaround at that stop (0:45 unless the pilot gave one). Work this out as an instant, then write it with the offset of that leg's departure airport on that date; airports in one day can be in different zones (e.g. California and Sonora in winter).
- In the table, give each departure time in local time at its airport.

From each result:
- **ETE** = `summary.flight_time_seconds` / 60, rounded to the nearest minute, as `h:mm`.
- **Fuel** = `summary.fuel`. If its unit is POUNDS, convert to US gallons (avgas 6.0 lb/gal, Jet-A 6.7 lb/gal, by `aircraft.fuel_type`). One decimal.

If any leg fails (unknown airport, no aircraft), stop and say which leg; never fill in a guess.

## 4. Reply with the link

Build one link in exactly this form (no spaces; lists are comma-separated, leg 1 first):

```
https://days-flight-schedule.netlify.app/?apts=KSBA,KSDM,MMSF,MMLT&ete=1:56,1:42,3:23&gal=12.2,10.8,21.4&wu=08:00&date=2026-11-16
```

- `apts`: every airport in order, 2 to 6 of them, 2 to 4 letters/digits each.
- `ete`: one `h:mm` per leg.
- `gal`: one number per leg, up to one decimal.
- `wu`: Wheels Up 1, 24-hour `HH:MM`, local at the first airport. Always include it.
- `date`: the flight date as `YYYY-MM-DD`. Always include it.
- Optional `turn`: one `h:mm` per stop (legs minus 1), only if the pilot gave turnarounds.
- Optional `route`: one entry per leg separated by `|`, spaces written as `+` (e.g. `route=DCT|V27+GVO|DCT`), only if the pilot gave routes.

Opening the link starts a new day in the app with these values and the app's defaults for everything else; the pilot's previous screen is saved in the app as "Before opening link".

In the reply, in this order:
1. A short table, one row per leg: from-to, departure time used, ETE, fuel (gal; show lb too if converted), distance, average wind component. Say the figures are from ForeFlight with the aircraft and profile used.
2. One line: the app adds 0:05 pattern/approach per leg and the turnarounds on top of these ETEs; check the schedule, then tap Save.
3. **Last, on its own line, with nothing after it:** the link as a markdown link titled **Open my new day in Day's Flight Schedule**. It must be the final thing in the reply so the pilot sees it without scrolling back.
