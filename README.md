# psych-scripts

Dashboard for the FNSW ROI plots. Drop in a csv from the google sheet, pick a
layout, hit run. R draws a plot for every condition and you download them as png
or pdf, or grab the whole lot as a zip.

## Running it

You need node and R. R wants a few packages:

```r
install.packages(c("tidyverse", "cowplot", "scales"))
```

Then:

```
npm install
npm run dev
```

and open http://localhost:5173

For a proper build:

```
npm run build
npm start
```

## What the sheet needs

Both layouts want a condition column (1 face, 2 number, 3 geometry, 4 word) and a
sex column. The age layout also wants an age column. Anything named like
`2001 Precentral_L` counts as an ROI, so extra metadata columns are left alone.

It is fairly forgiving about the rest:

- Headers get tidied, so `Participant`, `Condition`, `Sex_m0f1`, `Subject` and
  `Age` all work, and a stray quote left on the last header cell is stripped.
- Sex can be 0 and 1, 1 and 2, or `M` and `F`. It ends up as 0 for men and 1 for
  women either way.
- Rows with no usable sex, condition or age are set aside instead of taking the
  run down with them. The count shows up under the plot so you know it happened.
- Regions without at least two readings in both groups are left out of the
  ranking rather than sorting to the top on a divide by zero.
- Windows line endings are fine.

## Just the R part

```
Rscript R/run_analysis.R --input data.csv --outdir out --mode sex --top-n 10
```

`mode` is `sex` (men vs women) or `age` (each sex split at its median age). It
writes a png and a pdf per condition plus a log and a manifest.

The two original scripts are still here as `adults` and `mosiac script`.

## Putting it online

There is a `render.yaml` and a `Dockerfile`, so Render can build it as a
Blueprint. Point Render at this repo, pick the `roi-dashboard` branch, and it
installs R and node into the image itself. Nothing to configure by hand.

The free instance sleeps when nobody is using it, so the first hit after a quiet
spell takes about a minute to wake up before it will do anything.

## Notes

Uploads land in `.jobs/` locally, or `/tmp/jobs` on Render, and get swept after a
few hours. Nothing is kept.

A run is queued rather than done on the spot, since a full sheet takes long
enough that the browser would otherwise be left holding a request open. The page
polls until the plots are ready. Only one run happens at a time, because R with
the tidyverse loaded is the heaviest thing on a small box.

If R lives somewhere odd, set `RSCRIPT` to its path.
