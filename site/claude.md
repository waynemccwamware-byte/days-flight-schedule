# Day's Flight Schedule: a new day with ETE and fuel from ForeFlight

Reference for Claude, written by the app's author (Wayne McClelland, GeezerGeek Pilot). A pilot pressed one of the two ForeFlight buttons in the Day's Flight Schedule app (https://days-flight-schedule.netlify.app/). The job: plan a new flying day by getting each leg's ETE and fuel from their ForeFlight account, then reply with one link that opens the app with that day filled in.

- **"Get ETE/fuel from ForeFlight FPL (Maps tab)"**: the pilot gives airports; follow sections 1 to 4.
- **"Get full info from ForeFlight Flights tab"**: bring in the Flights already saved in ForeFlight for the date; follow sections 1 and 5 (section 5 uses the link format in section 4).

**Fuel in this app is always trip burn plus start/taxi/takeoff fuel**, in US gallons, one decimal. Never include reserve.

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
- **Fuel** = `summary.fuel` (trip burn) + the aircraft's `fuel.start_taxi_takeoff` from `list_aircraft`. Convert any value in POUNDS to US gallons first (avgas 6.0 lb/gal, Jet-A 6.7 lb/gal, by `aircraft.fuel_type`). One decimal.

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
1. A short table, one row per leg: from-to, departure time used, ETE, fuel (gal, trip + taxi; show lb too if converted), distance, average wind component. Say the figures are from ForeFlight with the aircraft and profile used.
2. One line: the app adds 0:05 pattern/approach per leg and the turnarounds on top of these ETEs; check the schedule, then tap Save.
3. **Last, on its own line, with nothing after it:** the link as a markdown link titled **Open my new day in Day's Flight Schedule**. It must be the final thing in the reply so the pilot sees it without scrolling back.

## 5. "Get full info from ForeFlight Flights tab": the saved Flights for the date

The pilot's message gives the date. Do not ask for airports, aircraft or times; they come from the saved Flights.

**Find the Flights.** Call `list_flights` with `page_size` 100, `departure_start` = the day before the date at 00:00Z and `departure_end` = the day after the date at 23:59Z (a wide window, because a local evening departure can be the next day in UTC). Keep only flights whose `departure_time.local_date` equals the date. Sort by `departure_time.epoch_seconds`.

**Check before building.** Build the link only if the kept flights form one clean chain:
- each leg's `to` is the next leg's `from`;
- one aircraft for all legs;
- 1 to 5 legs (the app holds at most 5);
- no duplicates (two flights with the same from, to and departure time, or overlapping legs).

If any check fails, show the flights found (from-to, departure local time, tail, ETE) and ask which to use, then build the link from the pilot's choice. If no flights are saved for that date, say so and offer to plan the day from airports instead (sections 2 to 4).

**Per leg, from each flight's own fields** (the saved Flight is authoritative; do not recalculate it):
- **ETE** = `flight_time_seconds` / 60, rounded to the nearest minute, as `h:mm`.
- **Fuel** = `fuel.to_destination` + `fuel.taxi`, in US gallons (convert POUNDS as in section 3), one decimal. Example: 16.4 + 2.0 = 18.4.
- **Note** (goes in the link's `route` entry for the leg, at most 200 characters): flight rules and cruise altitude, then the route, then the alternate if there is one, e.g. `IFR 6000: GVO V27 MQO V113 PRB JOBUS; alt KLVK`. No route saved: `direct`. Add the tail number to leg 1's note only, at the end: `; N211WP`.

**Times.**
- `wu` = leg 1's `departure_time.local_time_24`.
- `turn` for each stop k = leg k+1's departure − (leg k's departure + leg k's ETE + 0:05), worked out from `epoch_seconds` in minutes, as `h:mm`. The app adds 0:05 pattern/approach to every leg, so this makes each Wheels Up match the saved ETD. If a turn comes out below 0:00, use 0:00 and say which stop in the reply.
- `date` = the date.

**Link.** Section 4's format, with `apts`, `ete`, `gal`, `wu`, `date`, `turn` (if 2+ legs) and `route`. In `route`, separate legs with `|`, write spaces as `+`, and percent-encode anything other than letters, digits, `+`, `.`, `-` and `|` (e.g. `:` as `%3A`, `;` as `%3B`).

**Reply.** In this order:
1. A short table, one row per leg: from-to, ETD (local), ETE, fuel (trip + taxi), rules and altitude, route, alternate. Say the figures are as saved in the pilot's ForeFlight Flights, with the aircraft.
2. One line: these are the values as last calculated in ForeFlight; for current winds, open each Flight in ForeFlight before flying.
3. **Last, on its own line, with nothing after it:** the link as a markdown link titled **Open my new day in Day's Flight Schedule**.
