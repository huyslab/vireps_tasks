#!/usr/bin/env Rscript
# Checks that simulated task data contain every variable the RELMED dashboard
# analyses need, runs those analyses (plus new GNG / PILT-test plots), and writes
# a Markdown report with the plots to validation/analysis/output/sim_report.md.
#
#   npm run sim:data      # Playwright: simulate participants -> validation/sim-data/*.json
#   npm run sim:analyse   # this script
#
# Exits non-zero if any check fails.

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(ggplot2)
  library(jsonlite)
})

script_dir <- local({
  args <- commandArgs(trailingOnly = FALSE)
  f <- sub("^--file=", "", args[grep("^--file=", args)])
  if (length(f)) dirname(normalizePath(f)) else "validation/analysis"
})
source(file.path(script_dir, "dashboard_functions.R"))
source(file.path(script_dir, "task_functions.R"))

data_dir <- file.path(script_dir, "..", "sim-data")
out_dir <- file.path(script_dir, "output")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# experiment.html SESSION_CONFIG: session_number -> session label. In real data the
# session label also comes from the REDCap record (saveDataREDCap's `session` field).
SESSION_MAP <- c(`1` = "wk0", `2` = "wk2", `3` = "wk4", `4` = "wk24", `5` = "wk28")

# ---- Load ------------------------------------------------------------------

# Mirrors the dashboard's redcap_data_to_df(): one row per trial, nested values
# serialised to JSON strings, everything character, then type.convert().
flatten_trial <- function(tr) {
  lapply(tr, function(v) {
    if (is.null(v)) NA_character_
    else if (is.list(v) || length(v) != 1) as.character(toJSON(v, auto_unbox = TRUE))
    else as.character(v)
  })
}

files <- list.files(data_dir, pattern = "\\.json$", full.names = TRUE)
if (!length(files)) stop("No simulated data in ", data_dir, " - run `npm run sim:data` first.")

runs <- lapply(files, function(f) {
  raw <- fromJSON(f, simplifyVector = FALSE)
  df <- bind_rows(lapply(raw$trials, flatten_trial)) |> type.convert(as.is = TRUE)
  df |> mutate(
    sim_task = raw$task,
    participant_id = sprintf("REL-SIM-%04d", as.integer(raw$participant)),
    session = unname(SESSION_MAP[as.character(raw$session_number)]),
    .before = 1
  )
})
names(runs) <- basename(files)
by_task <- split(runs, vapply(runs, function(d) d$sim_task[1], ""))
task_df <- lapply(by_task, bind_rows)
sim_accuracy <- unique(unlist(lapply(files, function(f) fromJSON(f)$sim_accuracy)))

# ---- Checks ------------------------------------------------------------------

checks <- list()
add_check <- function(task, check, ok, detail = "") {
  checks[[length(checks) + 1]] <<- tibble(task = task, check = check,
                                          result = ifelse(isTRUE(ok), "PASS", "FAIL"),
                                          detail = detail)
}
check_columns <- function(task, df, cols, source) {
  for (col in cols) {
    present <- col %in% names(df)
    n_na <- if (present) sum(is.na(df[[col]])) else NA
    add_check(task, sprintf("column `%s`", col), present && n_na < nrow(df),
              if (!present) paste("missing - needed by", source)
              else sprintf("%s; %d/%d NA", class(df[[col]])[1], n_na, nrow(df)))
  }
}
check_values <- function(task, df, col, allowed) {
  if (!col %in% names(df)) return(invisible())
  bad <- setdiff(unique(df[[col]]), allowed)
  add_check(task, sprintf("`%s` values in {%s}", col, paste(allowed, collapse = ", ")),
            length(bad) == 0, if (length(bad)) paste("unexpected:", paste(bad, collapse = ", ")) else "")
}

# PILT ------------------------------------------------------------------------
pilt_raw <- task_df$PILT
pilt <- split_card_choosing(pilt_raw, "pilt")
check_columns("PILT", pilt,
  c("participant_id", "session", "trialphase", "block", "trial", "response", "rt",
    "response_optimal", "optimal_right", "feedback_left", "feedback_right",
    "stimulus_left", "stimulus_right", "chosen_stimulus", "chosen_feedback"),
  "dashboard pilt_wm.R / PILT_modeling")
add_check("PILT", "main-task rows after split_card_choosing", nrow(pilt) > 0, sprintf("%d rows", nrow(pilt)))
add_check("PILT", "`response_optimal` is logical", is.logical(pilt$response_optimal), class(pilt$response_optimal)[1])
add_check("PILT", "`block` integer-valued (practice excluded)", all(pilt$block == as.integer(pilt$block)),
          paste("blocks:", paste(sort(unique(pilt$block)), collapse = " ")))
add_check("PILT", "derived block `valence` (from feedback signs)", all(!is.na(pilt$valence)),
          paste(names(table(pilt$valence)), table(pilt$valence), sep = "=", collapse = ", "))
check_values("PILT", pilt, "response", c("left", "right", "noresp"))

# PILT test -------------------------------------------------------------------
test_raw <- task_df$post_PILT_test
pilt_test <- split_card_choosing(test_raw, "pilt_test")
pit_test <- test_raw |> filter(trialphase == "pilt_test", block == "pavlovian")
check_columns("PILT test", pilt_test,
  c("participant_id", "session", "trialphase", "block", "trial", "response", "rt",
    "stimulus_left", "stimulus_right", "EV_left", "EV_right", "same_valence",
    "same_block", "original_block_left", "original_block_right"),
  "PILT_modeling data_prep.R / test-phase plots")
n_test <- pilt_test |> count(participant_id, session)
add_check("PILT test", "≤ 60 non-Pavlovian test trials per session (PILT_modeling assert)",
          all(n_test$n <= 60), paste("n per participant:", paste(n_test$n, collapse = ", ")))
add_check("PILT test", "Pavlovian (PIT test) block present", nrow(pit_test) > 0,
          sprintf("%d rows with block == 'pavlovian'", nrow(pit_test)))
check_values("PILT test", pilt_test, "response", c("left", "right", "noresp"))
learn_stims <- unique(basename(c(pilt$stimulus_left, pilt$stimulus_right)))
test_stims <- unique(basename(c(pilt_test$stimulus_left, pilt_test$stimulus_right)))
missing_stims <- setdiff(test_stims, learn_stims)
add_check("PILT test", "test stimuli all appeared in PILT learning (basename match)",
          length(missing_stims) == 0,
          if (length(missing_stims)) paste("not in PILT:", paste(head(missing_stims, 5), collapse = ", "))
          else sprintf("%d test stimuli matched", length(test_stims)))

# Reversal ----------------------------------------------------------------------
rev_raw <- task_df$reversal |> filter(trial_type == "reversal")
check_columns("Reversal", rev_raw,
  c("participant_id", "session", "trial_type", "block", "trial", "response", "rt",
    "response_optimal", "optimal_right", "feedback_left", "feedback_right", "chosen_feedback"),
  "dashboard reversal.R")
reversal <- preprocess_reversal(rev_raw)
add_check("Reversal", "`response_optimal` is logical", is.logical(rev_raw$response_optimal),
          class(rev_raw$response_optimal)[1])
starts <- rev_raw |> group_by(participant_id, block) |> summarise(first = min(trial), .groups = "drop")
add_check("Reversal", "`trial` restarts at 1 in every block", all(starts$first == 1),
          sprintf("%d blocks checked", nrow(starts)))
check_values("Reversal", rev_raw, "response", c("left", "right", NA))

# GNG -------------------------------------------------------------------------
gng_raw <- task_df$go_no_go |> filter(trialphase == "go_no_go")
check_columns("GNG", gng_raw,
  c("participant_id", "session", "trialphase", "block", "trial", "cue", "cue_id",
    "valence", "affect", "sham", "correct_response", "condition", "response", "rt",
    "correct", "outcome", "outcome_correct", "outcome_incorrect", "face_model"),
  "GNG analysis (P(go) by valence x action, affect, bonus)")
gng <- prepare_gng(gng_raw)
check_values("GNG", gng_raw, "response", c("go", "nogo"))
check_values("GNG", gng_raw, "valence", c("win", "avoid_loss"))
check_values("GNG", gng_raw, "correct_response", c("go", "nogo"))
add_check("GNG", "`correct` == (response == correct_response)",
          all(gng$correct == (gng$response == gng$correct_response)), "")
add_check("GNG", "`outcome` matches outcome_correct / outcome_incorrect",
          all(gng$outcome == ifelse(gng$correct, gng$outcome_correct, gng$outcome_incorrect)), "")
add_check("GNG", "go trials have rt, no-go trials have none",
          all(!is.na(gng$rt[gng$go])) && all(is.na(gng$rt[!gng$go])), "")
cond_map <- gng |> distinct(condition, valence, correct_response) |> arrange(condition)
add_check("GNG", "`condition` maps one-to-one onto valence x correct_response",
          nrow(cond_map) == 4 && n_distinct(cond_map$condition) == 4,
          paste(sprintf("%s=%s/%s", cond_map$condition, cond_map$valence, cond_map$correct_response),
                collapse = ", "))
cells <- gng |> count(participant_id, block, valence, correct_response, affect)
add_check("GNG", "every participant x block has all 8 valence x action x affect cells",
          all(table(cells$participant_id, cells$block) == 8),
          sprintf("trials per cell: %s", paste(sort(unique(cells$n)), collapse = "/")))

checks <- bind_rows(checks)

# ---- Plots --------------------------------------------------------------------

save_plot <- function(p, name, width = 8, height = 5) {
  ggsave(file.path(out_dir, paste0(name, ".png")), p, width = width, height = height, dpi = 110)
  paste0(name, ".png")
}
plots <- list(
  PILT = c(
    "Learning curves (dashboard `plot_pilt_learning_curves`)" =
      save_plot(plot_pilt_learning_curves(pilt), "pilt_learning_curves"),
    "Learning curves by block (dashboard `plot_pilt_learning_curves_by_block`)" =
      save_plot(plot_pilt_learning_curves_by_block(pilt), "pilt_learning_by_block", 12, 8)
  ),
  `PILT test` = c(
    "P(choose higher EV) by EV difference" =
      save_plot(plot_pilt_test_by_ev(prepare_pilt_test(pilt_test)), "pilt_test_by_ev")
  ),
  Reversal = c(
    "Accuracy around reversals (dashboard `plot_reversal_accuracy`)" =
      save_plot(plot_reversal_accuracy(reversal), "reversal_accuracy")
  ),
  GNG = c(
    "P(go) by valence x correct response" = save_plot(plot_gng_pgo_2x2(gng), "gng_pgo_2x2", 6, 5),
    "P(go) over trials" = save_plot(plot_gng_learning(gng), "gng_learning", 10, 5),
    "Accuracy by face affect" = save_plot(plot_gng_accuracy_by_affect(gng), "gng_accuracy_affect", 6, 5),
    "Go RTs" = save_plot(plot_gng_rt(gng), "gng_rt", 7, 5),
    "Cumulative points" = save_plot(plot_gng_cumulative_outcome(gng), "gng_cumulative_outcome", 7, 5)
  )
)

# ---- Summaries --------------------------------------------------------------

md_table <- function(df) {
  df <- mutate(df, across(everything(), ~ ifelse(is.na(.x), "", as.character(.x))))
  c(paste("|", paste(names(df), collapse = " | "), "|"),
    paste("|", paste(rep("---", ncol(df)), collapse = " | "), "|"),
    apply(df, 1, function(r) paste("|", paste(gsub("\\|", "\\\\|", r), collapse = " | "), "|")))
}
r2 <- function(x) round(x, 2)

summaries <- list(
  PILT = pilt |> group_by(participant_id) |>
    summarise(trials = n(), blocks = n_distinct(block), p_optimal = r2(mean(response_optimal)),
              noresp = sum(response == "noresp"), .groups = "drop"),
  `PILT test` = pilt_test |> group_by(participant_id) |>
    summarise(trials = n(), pavlovian_trials = sum(pit_test$participant_id == first(participant_id)),
              p_optimal = r2(mean(response_optimal, na.rm = TRUE)), .groups = "drop"),
  Reversal = reversal |> group_by(participant_id) |>
    summarise(trials = n(), reversals = max(block) - 1, p_optimal = r2(mean(response_optimal)),
              .groups = "drop"),
  GNG = gng |> group_by(valence, correct_response) |>
    summarise(trials = n(), p_go = r2(mean(go)), p_correct = r2(mean(correct)),
              mean_points = r2(mean(outcome)), .groups = "drop")
)

# ---- Report -------------------------------------------------------------------

n_fail <- sum(checks$result == "FAIL")
task_order <- c("PILT", "PILT test", "Reversal", "GNG")
md <- c(
  "# Simulated-data analysis check",
  "",
  sprintf("Generated %s from `validation/sim-data/` (%d files).", format(Sys.time(), "%Y-%m-%d %H:%M"), length(files)),
  "",
  sprintf("- Simulated participants per task: %s",
          paste(sprintf("%s = %d", names(by_task), lengths(by_task)), collapse = ", ")),
  sprintf("- Simulated participant accuracy (`sim_accuracy`): %s", paste(sim_accuracy, collapse = ", ")),
  "- Session: `wk0` (session_number 1). In real data `session` and `module_start_time` are added from the REDCap record, not the jsPsych trials.",
  "- Dashboard functions copied from huyslab/relmed_analysis_behaviour @ 94e68f1 (see `dashboard_functions.R`).",
  "",
  sprintf("**Overall: %d checks, %d failed.**", nrow(checks), n_fail),
  ""
)
for (t in task_order) {
  md <- c(md, paste("##", t), "", "### Variable checks", "",
          md_table(checks |> filter(task == t) |> select(-task)), "",
          "### Summary", "", md_table(summaries[[t]]), "")
  for (i in seq_along(plots[[t]])) {
    md <- c(md, paste("###", names(plots[[t]])[i]), "", sprintf("![](%s)", plots[[t]][i]), "")
  }
}
writeLines(md, file.path(out_dir, "sim_report.md"))

print(as.data.frame(checks |> filter(result == "FAIL")), right = FALSE)
cat(sprintf("\n%d checks, %d failed. Report: %s\n", nrow(checks), n_fail,
            normalizePath(file.path(out_dir, "sim_report.md"))))
if (n_fail > 0) quit(status = 1)
