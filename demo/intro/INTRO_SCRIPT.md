# Intro: Problem statement (0:00 → 0:24)

Five 4.8-second shots (authored at 4 s, rendered with a 1.2× time-stretch). Three are built from real data and render automatically (S2, S3, S5). Two need
AI footage from Higgsfield (S1, S4). Until those clips exist, the render shows labelled placeholders,
so you can review timing first.

```bash
cd demo && node record_segment.mjs intro    # -> out/intro_1080p60.mp4 (+ _av1.mp4), about 1 min
```

## Shots and voiceover

~50 words over 24 s. Each line starts as its shot appears.

| # | Time | Picture | On-screen text | VO |
|---|---|---|---|---|
| S1 | 0:00–0:04.8 | **Higgsfield:** molten steel pour, slow push-in | *India's steel runs on manganese.* | "Every tonne of Indian steel needs manganese —" |
| S2 | 0:04.8–0:09.6 | Bars grow: mined 2.70 Mt vs imported 6.50 Mt | *We import more than twice what we mine.* | "yet we import more than twice as much as we mine." |
| S3 | 0:09.6–0:14.4 | Satellite fly-in from India to the Balaghat–Nagpur belt; MOIL mines light up | 503.6 Mt known · only 15% proven · *85% is still unproven, underground.* | "Eighty-five percent of known manganese is still unproven, underground." |
| S4 | 0:14.4–0:19.2 | **Higgsfield:** flooded open pit in monsoon rain, stalled dumper | *Mines lose output to monsoon rain and equipment breakdowns.* | "And working mines lose output to monsoon rain and equipment breakdowns —" |
| S5 | 0:19.2–0:24 | Production line falls below plan during a rain spell; month-end marker and gap | *…and it's found only after the month closes.* | "usually found only after the month has closed." |

Then cut to the 0:20 solution section.

**Facts used (all on screen with their source):** Indian Bureau of Mines, *Indian Minerals Yearbook
2022, Manganese Ore* (`docs/references/Manganese_Ore_2022.pdf`): production 2,696 kt and imports
6.50 Mt in 2021–22; resources 503.62 Mt, of which 75.04 Mt are Reserves (as on 01.04.2020, UNFC).
S5 is marked *Illustrative*; its "−7% vs plan" is computed from the drawn line.

## Higgsfield clips

Generate each at **16:9, 1080p or higher, at least 4 s**. Save them as
`demo/intro/clips/s1.mp4` and `demo/intro/clips/s4.mp4` (any format ffmpeg reads), then re-run the
render. The first 4 s of each clip are used, cropped to fill the frame with a slow push-in, under a
dark bottom gradient for the text. Keep the lower third fairly clean: that's where the text sits.

**S1: steel (4 s)**

> Cinematic slow-motion close-up of molten steel pouring from a ladle in a steel plant, bright orange
> glow and sparks against a dark industrial interior, drifting smoke, shallow depth of field, slow
> dolly-in, photoreal, 24 fps film look, warm amber highlights, deep shadows, no text, no logos, no people.

**S4: monsoon mine (4 s)**

> Aerial drone shot slowly descending over an open-pit manganese mine in central India during heavy
> monsoon rain, dark reddish-brown terraced benches, muddy water pooling on the haul road, a yellow
> dump truck stuck in mud, grey overcast sky, visible rain streaks, moody desaturated colour grade,
> photoreal, no text, no logos.

**Backup for S4** (if the aerial reads as generic):

> Night, heavy rain at a mine site, a mechanic with a flashlight kneeling beside a broken-down mining
> dump truck, rain in the light beam, reflections in muddy puddles, slight handheld motion, photoreal,
> no text, no logos.

**Current clips (26 Sep):** S1 is a 360×640 vertical phone clip of an induction-furnace pour (first
4 s), laid out as a portrait panel over a blurred copy of itself so it isn't upscaled 4×. S4 is a
Flow/Veo clip; its bottom-right sparkle watermark is cropped out (1120×630 window). Both treatments
live in `FX` in `record_segment.mjs`.

Tips: generate 3–4 variants and pick the one with the slowest, steadiest camera. Fast motion fights
the text. Keep the "Illustrative footage" tag; it tells judges these shots are AI visuals, not MOIL
footage.
