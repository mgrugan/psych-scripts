#!/usr/bin/env Rscript

# Entry point used by the web dashboard.
#
#   Rscript R/run_analysis.R --input data.csv --outdir out --mode sex --top-n 10
#
# mode = "sex" is the adults script (men vs women, one block each).
# mode = "age" is the mosaic script (men vs women, each split at its median age).
#
# Writes one PNG + one PDF per condition into --outdir, plus manifest.json
# and log.txt.

suppressWarnings(suppressMessages({
  library(tidyverse)
  library(grid)
  library(cowplot)
}))

# ---------------------------------------------------------------- arguments --

parse_args <- function(argv) {
  out <- list(
    input  = NA_character_,
    outdir = NA_character_,
    mode   = "sex",
    top_n  = 10,
    width  = 14,
    height = 11,
    dpi    = 200
  )
  i <- 1
  while (i <= length(argv)) {
    key <- argv[[i]]
    val <- if (i < length(argv)) argv[[i + 1]] else NA_character_
    switch(key,
      "--input"  = { out$input  <- val; i <- i + 2 },
      "--outdir" = { out$outdir <- val; i <- i + 2 },
      "--mode"   = { out$mode   <- val; i <- i + 2 },
      "--top-n"  = { out$top_n  <- as.numeric(val); i <- i + 2 },
      "--width"  = { out$width  <- as.numeric(val); i <- i + 2 },
      "--height" = { out$height <- as.numeric(val); i <- i + 2 },
      "--dpi"    = { out$dpi    <- as.numeric(val); i <- i + 2 },
      { i <- i + 1 }
    )
  }
  out
}

opts <- parse_args(commandArgs(trailingOnly = TRUE))

if (is.na(opts$input) || is.na(opts$outdir)) {
  stop("--input and --outdir are both required", call. = FALSE)
}
if (!file.exists(opts$input)) {
  stop(paste0("input file not found: ", opts$input), call. = FALSE)
}
if (!opts$mode %in% c("sex", "age")) {
  stop("--mode must be either 'sex' or 'age'", call. = FALSE)
}

dir.create(opts$outdir, recursive = TRUE, showWarnings = FALSE)

log_path <- file.path(opts$outdir, "log.txt")
log_con  <- file(log_path, open = "wt")
say <- function(...) {
  line <- paste0(...)
  cat(line, "\n", sep = "", file = log_con)
  cat(line, "\n", sep = "")
}

# ------------------------------------------------------------------- loading --

raw <- read.csv(opts$input, check.names = FALSE)

# Tolerate the handful of header spellings that come out of the sheet.
rename_if_present <- function(df, from, to) {
  hit <- which(tolower(names(df)) == tolower(from))
  if (length(hit) == 1 && !(to %in% names(df))) names(df)[hit] <- to
  df
}

for (pair in list(
  c("Participant", "ParticipantID"),
  c("ParticipantId", "ParticipantID"),
  c("Subject", "ParticipantID"),
  c("Condition", "ConditionCode"),
  c("Sex_m0f1", "Sex"),
  c("Sex_M0F1", "Sex"),
  c("Gender", "Sex"),
  c("Age", "AgeYears"),
  c("Age_Years", "AgeYears")
)) {
  raw <- rename_if_present(raw, pair[1], pair[2])
}

required <- c("ConditionCode", "Sex")
if (opts$mode == "age") required <- c(required, "AgeYears")
missing_cols <- setdiff(required, names(raw))
if (length(missing_cols) > 0) {
  stop(paste0("missing required column(s): ", paste(missing_cols, collapse = ", ")),
       call. = FALSE)
}
if (!"ParticipantID" %in% names(raw)) raw$ParticipantID <- seq_len(nrow(raw))

dat <- raw %>%
  mutate(
    ConditionCode = as.numeric(ConditionCode),
    Sex = as.numeric(Sex),
    ConditionName = case_when(
      ConditionCode == 1 ~ "FACE",
      ConditionCode == 2 ~ "NUMBER",
      ConditionCode == 3 ~ "GEOMETRY",
      ConditionCode == 4 ~ "WORD",
      TRUE ~ paste0("CONDITION_", ConditionCode)
    )
  )

if (opts$mode == "age") {
  dat <- dat %>% mutate(AgeYears = as.numeric(AgeYears))
}

meta_cols <- c("ParticipantID", "ConditionCode", "Sex", "AgeYears", "ConditionName")

# AAL columns are named with their region number first, e.g. "2001 Precentral_L".
# When any column looks like that, only those count, which keeps stray numeric
# metadata (site, batch, run number) out of the ranking. Otherwise fall back to
# every remaining column that carries numbers.
candidate_cols <- setdiff(names(dat), meta_cols)

is_numeric_col <- function(cl) {
  v <- suppressWarnings(as.numeric(as.character(dat[[cl]])))
  sum(!is.na(v)) > 0
}

numeric_cols <- candidate_cols[vapply(candidate_cols, is_numeric_col, logical(1))]
aal_cols <- numeric_cols[grepl("^[0-9]+[^0-9]", numeric_cols)]

roi_cols <- if (length(aal_cols) > 0) aal_cols else numeric_cols

dropped <- setdiff(candidate_cols, roi_cols)

if (length(roi_cols) == 0) {
  stop("no numeric ROI columns found in the upload", call. = FALSE)
}

dat[, roi_cols] <- lapply(dat[, roi_cols], function(x) as.numeric(as.character(x)))

top_n <- max(1, min(as.numeric(opts$top_n), length(roi_cols)))

say("mode: ", opts$mode)
say("rows: ", nrow(dat), " | roi columns: ", length(roi_cols), " | top n: ", top_n)
if (length(dropped) > 0) {
  say("ignored as non-roi: ", paste(dropped, collapse = ", "))
}

# -------------------------------------------------------------------- legend --

make_extreme_legend <- function(bar_x_right = 0.60, title_size = 11) {

  n_steps <- 200

  blue_ramp <- colorRampPalette(c("#083DFF", "white"))(n_steps)
  red_ramp  <- colorRampPalette(c("#FF3B30", "white"))(n_steps)

  blue_raster <- as.raster(matrix(blue_ramp, nrow = 1))
  red_raster  <- as.raster(matrix(red_ramp,  nrow = 1))

  bar_x_left <- 0.05
  bar_width  <- bar_x_right - bar_x_left

  blue_title_y <- 0.74
  blue_bar_y   <- 0.62
  blue_bar_h   <- 0.05
  blue_tick_y  <- 0.50

  red_title_y <- 0.34
  red_bar_y   <- 0.22
  red_bar_h   <- 0.05
  red_tick_y  <- 0.10

  gTree(children = gList(
    textGrob("low-end extreme", x = bar_x_left, y = blue_title_y, hjust = 0,
             gp = gpar(fontface = "bold", fontsize = title_size)),
    rasterGrob(blue_raster, x = bar_x_left, y = blue_bar_y,
               width = bar_width, height = blue_bar_h,
               hjust = 0, vjust = 0.5, interpolate = TRUE),
    textGrob("max", x = bar_x_left,  y = blue_tick_y, hjust = 0, gp = gpar(fontsize = 8)),
    textGrob("mid", x = bar_x_right, y = blue_tick_y, hjust = 1, gp = gpar(fontsize = 8)),
    textGrob("high-end extreme", x = bar_x_left, y = red_title_y, hjust = 0,
             gp = gpar(fontface = "bold", fontsize = title_size)),
    rasterGrob(red_raster, x = bar_x_left, y = red_bar_y,
               width = bar_width, height = red_bar_h,
               hjust = 0, vjust = 0.5, interpolate = TRUE),
    textGrob("max", x = bar_x_left,  y = red_tick_y, hjust = 0, gp = gpar(fontsize = 8)),
    textGrob("mid", x = bar_x_right, y = red_tick_y, hjust = 1, gp = gpar(fontsize = 8))
  ))
}

# ------------------------------------------------------- shared calculations --

rank_rois <- function(cond_df) {
  tibble(
    ROI = roi_cols,
    boys_mean  = map_dbl(roi_cols, ~ mean(cond_df[cond_df$Sex == 0, .x], na.rm = TRUE)),
    girls_mean = map_dbl(roi_cols, ~ mean(cond_df[cond_df$Sex == 1, .x], na.rm = TRUE)),
    boys_sd    = map_dbl(roi_cols, ~ sd(cond_df[cond_df$Sex == 0, .x], na.rm = TRUE)),
    girls_sd   = map_dbl(roi_cols, ~ sd(cond_df[cond_df$Sex == 1, .x], na.rm = TRUE)),
    boys_n     = map_dbl(roi_cols, ~ sum(!is.na(cond_df[cond_df$Sex == 0, .x]))),
    girls_n    = map_dbl(roi_cols, ~ sum(!is.na(cond_df[cond_df$Sex == 1, .x])))
  ) %>%
    mutate(
      pooled_sd = sqrt(((boys_n - 1) * boys_sd^2 +
                          (girls_n - 1) * girls_sd^2) / (boys_n + girls_n - 2)),
      standardized_diff = abs(boys_mean - girls_mean) / pooled_sd
    ) %>%
    arrange(desc(standardized_diff))
}

build_thresholds <- function(cond_df, selected_roi_cols) {

  threshold_df <- tibble()

  for (roi in selected_roi_cols) {

    boys_values  <- cond_df[cond_df$Sex == 0, roi]
    girls_values <- cond_df[cond_df$Sex == 1, roi]

    boys_mean  <- mean(boys_values,  na.rm = TRUE)
    girls_mean <- mean(girls_values, na.rm = TRUE)

    if (girls_mean > boys_mean) {
      lower_values    <- boys_values
      higher_values   <- girls_values
      low_color_sign  <- -1
      high_color_sign <- 1
      topg <- "girls"
    } else {
      lower_values    <- girls_values
      higher_values   <- boys_values
      low_color_sign  <- 1
      high_color_sign <- -1
      topg <- "boys"
    }

    threshold_df <- bind_rows(threshold_df, tibble(
      ROI = roi,
      lowthresh       = as.numeric(quantile(lower_values,  0.33, na.rm = TRUE)),
      highthresh      = as.numeric(quantile(higher_values, 0.67, na.rm = TRUE)),
      low_extreme     = min(lower_values,  na.rm = TRUE),
      high_extreme    = max(higher_values, na.rm = TRUE),
      low_color_sign  = low_color_sign,
      high_color_sign = high_color_sign,
      topg            = topg
    ))
  }

  threshold_df
}

shape_plot_df <- function(cond_df, selected_roi_cols, selected_roi_numbers,
                          threshold_df, extra_cols = character(0)) {
  cond_df %>%
    select(ParticipantID, Sex, ParticipantRow, all_of(extra_cols),
           all_of(selected_roi_cols)) %>%
    pivot_longer(cols = all_of(selected_roi_cols),
                 names_to = "ROI", values_to = "Value") %>%
    left_join(threshold_df, by = "ROI") %>%
    mutate(
      ROI_number = str_extract(ROI, "^[0-9]+"),
      ROI_number = ifelse(is.na(ROI_number), ROI, ROI_number),
      ROI_number = factor(ROI_number, levels = selected_roi_numbers),
      FillValue = case_when(
        Value < lowthresh & lowthresh != low_extreme ~
          low_color_sign * ((lowthresh - Value) / (lowthresh - low_extreme)),
        Value > highthresh & highthresh != high_extreme ~
          high_color_sign * ((Value - highthresh) / (high_extreme - highthresh)),
        TRUE ~ 0
      ),
      FillValue = pmax(pmin(FillValue, 1), -1)
    )
}

roi_labels <- function(selected_roi_cols) {
  n <- str_extract(selected_roi_cols, "^[0-9]+")
  ifelse(is.na(n), selected_roi_cols, n)
}

# ----------------------------------------------------------- mode: sex split --

make_plot_sex <- function(condition_name) {

  cond_df <- dat %>%
    filter(ConditionName == condition_name) %>%
    arrange(Sex)

  if (sum(cond_df$Sex == 0) == 0 || sum(cond_df$Sex == 1) == 0) {
    say("skipping ", condition_name, ": needs both sexes present")
    return(NULL)
  }

  GAP <- 8

  base_row <- seq_len(nrow(cond_df))
  cond_df$ParticipantRow <- ifelse(cond_df$Sex == 1, base_row + GAP, base_row)

  boys_rows  <- cond_df$ParticipantRow[cond_df$Sex == 0]
  girls_rows <- cond_df$ParticipantRow[cond_df$Sex == 1]

  sex_split_y  <- max(boys_rows) + (GAP / 2) + 0.5
  boys_center  <- (min(boys_rows)  + max(boys_rows))  / 2
  girls_center <- (min(girls_rows) + max(girls_rows)) / 2

  roi_diffs <- rank_rois(cond_df)
  selected_roi_cols    <- roi_diffs$ROI[1:top_n]
  selected_roi_numbers <- roi_labels(selected_roi_cols)

  say("")
  say(condition_name, " top ", top_n, " rois by standardized men vs women difference:")
  say(paste(selected_roi_numbers, collapse = " "))
  say("men rows 1 - ", max(boys_rows),
      " | blank gap | women rows ", min(girls_rows), " - ", max(girls_rows))

  threshold_df <- build_thresholds(cond_df, selected_roi_cols)
  plot_df <- shape_plot_df(cond_df, selected_roi_cols, selected_roi_numbers, threshold_df)

  n_roi   <- as.numeric(top_n)
  label_x <- 0.15

  p <- ggplot(plot_df,
              aes(x = as.numeric(ROI_number), y = ParticipantRow, fill = FillValue)) +
    geom_tile(color = "gray", linewidth = 0.25) +
    geom_text(aes(label = sprintf("%.3f", Value)), size = 1.7, color = "gray") +
    scale_y_reverse() +
    scale_x_continuous(
      breaks = seq_len(n_roi),
      labels = selected_roi_numbers,
      expand = expansion(add = c(1.2, 0.4))
    ) +
    scale_fill_gradientn(
      colours = c("blue", "white", "white", "red"),
      values  = scales::rescale(c(-1, 0, 0.001, 1)),
      limits  = c(-1, 1),
      guide   = "none"
    ) +
    geom_hline(yintercept = sex_split_y, colour = "black", linewidth = 3) +
    annotate("label", x = label_x, y = boys_center, label = "MEN",
             hjust = 0.5, vjust = 0.5, fontface = "bold", size = 6,
             colour = "black", fill = "white", label.size = 0.7) +
    annotate("label", x = label_x, y = girls_center, label = "WOMEN",
             hjust = 0.5, vjust = 0.5, fontface = "bold", size = 6,
             colour = "black", fill = "white", label.size = 0.7) +
    coord_cartesian(clip = "off") +
    labs(title = condition_name, x = "AAL ROI Number", y = NULL) +
    theme_minimal(base_size = 15) +
    theme(
      plot.title   = element_text(face = "bold", size = 30, hjust = 0.5),
      panel.grid   = element_blank(),
      axis.text.y  = element_blank(),
      axis.text.x  = element_text(size = 11, face = "bold"),
      axis.title.x = element_text(size = 16, face = "bold"),
      plot.margin  = margin(10, 10, 10, 40)
    )

  list(
    plot = plot_grid(p, make_extreme_legend(0.60, 11), ncol = 2, rel_widths = c(1, 0.42)),
    rois = selected_roi_numbers
  )
}

# ----------------------------------------------------------- mode: age split --

make_plot_age <- function(condition_name) {

  cond_df <- dat %>%
    filter(ConditionName == condition_name) %>%
    arrange(Sex, AgeYears)

  if (sum(cond_df$Sex == 0) == 0 || sum(cond_df$Sex == 1) == 0) {
    say("skipping ", condition_name, ": needs both sexes present")
    return(NULL)
  }

  cond_df$ParticipantRow <- seq_len(nrow(cond_df))

  boys_rows  <- cond_df$ParticipantRow[cond_df$Sex == 0]
  girls_rows <- cond_df$ParticipantRow[cond_df$Sex == 1]

  boys_ages  <- cond_df$AgeYears[cond_df$Sex == 0]
  girls_ages <- cond_df$AgeYears[cond_df$Sex == 1]

  boys_median  <- median(boys_ages,  na.rm = TRUE)
  girls_median <- median(girls_ages, na.rm = TRUE)

  sex_split_y <- max(boys_rows) + 0.5

  boys_below_median_count  <- sum(boys_ages  < boys_median,  na.rm = TRUE)
  girls_below_median_count <- sum(girls_ages < girls_median, na.rm = TRUE)

  boys_median_line_y  <- min(boys_rows)  + boys_below_median_count  - 0.5
  girls_median_line_y <- min(girls_rows) + girls_below_median_count - 0.5

  boys_younger_center  <- (min(boys_rows) + boys_median_line_y) / 2
  boys_older_center    <- (boys_median_line_y + max(boys_rows)) / 2
  girls_younger_center <- (min(girls_rows) + girls_median_line_y) / 2
  girls_older_center   <- (girls_median_line_y + max(girls_rows)) / 2

  roi_diffs <- rank_rois(cond_df)
  selected_roi_cols    <- roi_diffs$ROI[1:top_n]
  selected_roi_numbers <- roi_labels(selected_roi_cols)

  say("")
  say(condition_name, " top ", top_n, " rois by standardized boys vs girls difference:")
  say(paste(selected_roi_numbers, collapse = " "))
  say("boys median age: ",  boys_median)
  say("girls median age: ", girls_median)

  threshold_df <- build_thresholds(cond_df, selected_roi_cols)
  plot_df <- shape_plot_df(cond_df, selected_roi_cols, selected_roi_numbers,
                           threshold_df, extra_cols = "AgeYears")

  side_label_x        <- -0.2
  median_label_x      <- -0.2
  median_line_x_start <- 0.7
  median_line_x_end   <- top_n + 0.5

  group_labels_df <- tibble(
    y = c(boys_younger_center, boys_older_center,
          girls_younger_center, girls_older_center),
    label = c("younger", "older", "younger", "older")
  )

  median_labels_df <- tibble(
    y = c(boys_median_line_y, girls_median_line_y),
    label = c(sprintf("%.2f yrs old", boys_median),
              sprintf("%.2f yrs old", girls_median))
  )

  median_lines_df <- tibble(y = c(boys_median_line_y, girls_median_line_y))

  p <- ggplot(plot_df,
              aes(x = as.numeric(ROI_number), y = ParticipantRow, fill = FillValue)) +
    geom_tile(color = "gray", linewidth = 0.25) +
    geom_text(aes(label = sprintf("%.3f", Value)), size = 1.7, color = "gray") +
    geom_segment(
      data = median_lines_df,
      aes(x = median_line_x_start, xend = median_line_x_end, y = y, yend = y),
      linewidth = 0.6, color = "gray35", linetype = "dashed", inherit.aes = FALSE
    ) +
    geom_hline(yintercept = sex_split_y, linewidth = 1.2, color = "gray25") +
    geom_text(
      data = group_labels_df,
      aes(x = side_label_x, y = y, label = label),
      hjust = 1, color = "gray20", size = 3.5, inherit.aes = FALSE
    ) +
    geom_text(
      data = median_labels_df,
      aes(x = median_label_x, y = y, label = label),
      hjust = 1, color = "gray20", size = 3, fontface = "italic", inherit.aes = FALSE
    ) +
    scale_y_reverse() +
    scale_x_continuous(
      breaks = seq_len(top_n),
      labels = selected_roi_numbers,
      expand = expansion(add = c(1.8, 0.5))
    ) +
    scale_fill_gradientn(
      colours = c("blue", "white", "white", "red"),
      values  = scales::rescale(c(-1, 0, 0.001, 1)),
      limits  = c(-1, 1),
      guide   = "none"
    ) +
    coord_cartesian(clip = "off") +
    labs(title = condition_name, x = "AAL ROI Number", y = NULL) +
    theme_minimal(base_size = 15) +
    theme(
      plot.title   = element_text(face = "bold", size = 30, hjust = 0.5),
      panel.grid   = element_blank(),
      axis.text.y  = element_blank(),
      axis.text.x  = element_text(size = 16, face = "bold"),
      axis.title.x = element_text(size = 18, face = "bold"),
      plot.margin  = margin(10, 10, 10, 10)
    )

  list(
    plot = plot_grid(p, make_extreme_legend(0.75, 10), ncol = 2, rel_widths = c(1, 0.2)),
    rois = selected_roi_numbers
  )
}

# --------------------------------------------------------------------- render --

condition_order <- c("FACE", "NUMBER", "GEOMETRY", "WORD")
conditions <- unique(na.omit(dat$ConditionName))
conditions <- c(
  intersect(condition_order, conditions),
  sort(setdiff(conditions, condition_order))
)

safe_name <- function(x) gsub("[^A-Za-z0-9_-]+", "_", x)
json_string <- function(x) paste0('"', gsub('"', '\\\\"', as.character(x)), '"')

entries <- character(0)
index <- 0

for (condition_name in conditions) {

  built <- tryCatch(
    if (opts$mode == "age") make_plot_age(condition_name) else make_plot_sex(condition_name),
    error = function(e) {
      say("failed on ", condition_name, ": ", conditionMessage(e))
      NULL
    }
  )

  if (is.null(built)) next

  index <- index + 1
  stem <- sprintf("%02d-%s", index, safe_name(condition_name))

  png_name <- paste0(stem, ".png")
  pdf_name <- paste0(stem, ".pdf")

  ggsave(file.path(opts$outdir, png_name), built$plot,
         width = opts$width, height = opts$height, dpi = opts$dpi,
         limitsize = FALSE, bg = "white")

  ggsave(file.path(opts$outdir, pdf_name), built$plot,
         width = opts$width, height = opts$height,
         limitsize = FALSE, bg = "white")

  entries <- c(entries, paste0(
    "{",
    '"condition":', json_string(condition_name), ",",
    '"png":',       json_string(png_name), ",",
    '"pdf":',       json_string(pdf_name), ",",
    '"rois":[',     paste(vapply(built$rois, json_string, character(1)), collapse = ","), "]",
    "}"
  ))
}

if (index == 0) {
  stop("no conditions could be plotted from this file", call. = FALSE)
}

manifest <- paste0(
  "{",
  '"mode":',       json_string(opts$mode), ",",
  '"topN":',       top_n, ",",
  '"rows":',       nrow(dat), ",",
  '"roiCount":',   length(roi_cols), ",",
  '"plots":[',     paste(entries, collapse = ","), "]",
  "}"
)

writeLines(manifest, file.path(opts$outdir, "manifest.json"))

say("")
say("wrote ", index, " plot(s) to ", opts$outdir)
close(log_con)
