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
sex column (0 men, 1 women). The age layout also wants an age column. Anything
named like `2001 Precentral_L` counts as an ROI, so extra metadata columns are
left alone.

Headers get tidied on the way in, so `Participant`, `Condition`, `Sex_m0f1` and
`Age` all work.

## Just the R part

```
Rscript R/run_analysis.R --input data.csv --outdir out --mode sex --top-n 10
```

`mode` is `sex` (men vs women) or `age` (each sex split at its median age). It
writes a png and a pdf per condition plus a log and a manifest.

The two original scripts are still here as `adults` and `mosiac script`.

## Notes

Uploads land in `.jobs/` and get swept after 12 hours. If R lives somewhere odd,
set `RSCRIPT` to its path.
