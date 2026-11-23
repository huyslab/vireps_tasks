#!/usr/bin/env Rscript
# Checks that simulated task data contain every variable the RELMED dashboard
# analyses need, runs those analyses (plus new GNG / PILT-test plots), and writes
# a Markdown report with the plots to validation/analysis/output/sim_report.md.
#
#   npm run sim:data      # Playwright: simulate participants and publish a complete run
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

manifest_path <- file.path(data_dir, "latest.json")
if (!file.exists(manifest_path)) stop("No complete simulation run - run `npm run sim:data` first.")
manifest <- fromJSON(manifest_path, simplifyVector = FALSE)
n_participants <- manifest$participants
sim_accuracy <- manifest$sim_accuracy
session <- unname(SESSION_MAP[as.character(manifest$session_number)])
if (!isTRUE(grepl("^run-[[:alnum:]]+$", manifest$run)) ||
    !isTRUE(is.numeric(n_participants) && is.finite(n_participants) &&
            n_participants >= 1 && n_participants == floor(n_participants)) ||
    !isTRUE(is.numeric(sim_accuracy) && is.finite(sim_accuracy) && sim_accuracy >= 0 && sim_accuracy <= 1) ||
    !isTRUE(!is.na(session))) {
  stop("Invalid simulation run manifest: ", manifest_path)
}

expected <- expand_grid(
  task = c("PILT", "post_PILT_test", "reversal", "go_no_go"),
  participant = seq_len(n_participants)
)
files <- file.path(data_dir, manifest$run, sprintf("%s_sim%d.json", expected$task, expected$participant))
missing <- files[!file.exists(files)]
if (length(missing)) stop("Simulation run is incomplete. Missing datasets: ", paste(basename(missing), collapse = ", "))

runs <- lapply(seq_along(files), function(i) {
  raw <- fromJSON(files[i], simplifyVector = FALSE)
  if (!identical(raw$task, expected$task[i]) || !identical(raw$participant, expected$participant[i]) ||
      !identical(raw$sim_accuracy, sim_accuracy) || !identical(raw$session_number, manifest$session_number) ||
      !length(raw$trials)) {
    stop("Dataset does not match its simulation run manifest: ", files[i])
  }
  df <- bind_rows(lapply(raw$trials, flatten_trial)) |> type.convert(as.is = TRUE)
  df |> mutate(
    sim_task = raw$task,
    participant_id = sprintf("REL-SIM-%04d", as.integer(raw$participant)),
    session = .env$session,
    .before = 1
  )
})
names(runs) <- basename(files)
by_task <- split(runs, vapply(runs, function(d) d$sim_task[1], ""))
task_df <- lapply(by_task, bind_rows)

# ---- Checks ------------------------------------------------------------------

checks <- list()
add_check <- function(task, check, ok, detail = "") {
  checks[[length(checks) + 1]] <<- tibble(task = task, check = check,
                                          result = ifelse(isTRUE(ok), "PASS", "FAIL"),
                                          detail = detail)
}
check_columns <- function(task, df, cols, source, allow_missing = list()) {
  for (col in cols) {
    check <- sprintf("column `%s`", col)
    if (!col %in% names(df)) {
      add_check(task, check, FALSE, paste("missing - needed by", source))
      next
    }
    values <- df[[col]]
    missing <- is.na(values) | values %in% ""
    unexpected <- if (col %in% names(allow_missing)) missing & !allow_missing[[col]] else missing
    ids <- unique(df$participant_id[unexpected])
    detail <- sprintf("%s; %d/%d missing", class(values)[1], sum(missing), nrow(df))
    if (length(ids)) detail <- paste(detail, "in", paste(head(ids, 5), collapse = ", "))
    add_check(task, check, nrow(df) > 0 && !any(unexpected), detail)
  }
}
check_values <- function(task, df, col, allowed) {
  if (!col %in% names(df)) return(invisible())
  bad <- setdiff(unique(df[[col]]), allowed)
  add_check(task, sprintf("`%s` values in {%s}", col, paste(allowed, collapse = ", ")),
            length(bad) == 0, if (length(bad)) paste("unexpected:", paste(bad, collapse = ", ")) else "")
}

check_accuracy <- function(task, df, correct) {
  scores <- tibble(participant_id = df$participant_id, correct) |>
    group_by(participant_id) |>
    summarise(trials = n(), scored = sum(!is.na(correct)), hits = sum(correct %in% TRUE), .groups = "drop")
  scores <- bind_rows(scores, summarise(scores, participant_id = "overall", across(where(is.numeric), sum)))
  # Keep random runs stable while detecting large departures from the requested bias.
  # At both endpoints the lower and upper bounds are exactly the expected count.
  lower <- qbinom(1e-6, size = scores$trials, prob = sim_accuracy)
  upper <- qbinom(1 - 1e-6, size = scores$trials, prob = sim_accuracy)
  ok <- scores$trials == scores$scored & scores$hits >= lower & scores$hits <= upper
  add_check(task, "recorded accuracy matches `sim_accuracy`",
            nrow(scores) == n_participants + 1 && all(ok),
            paste(sprintf("%s: %d/%d correct (%d–%d expected, %d unscored)", scores$participant_id,
                          scores$hits, scores$trials, lower, upper, scores$trials - scores$scored), collapse = "; "))
}

check_choice_accuracy <- function(task, df) {
  optimal_side <- ifelse(df$optimal_right == 1, "right", "left")
  answered <- df$response %in% c("left", "right")
  correct <- ifelse(answered, df$response == optimal_side, NA)
  add_check(task, "`response_optimal` agrees with the chosen side", is.logical(df$response_optimal) &&
            all(df$response_optimal[answered] == correct[answered]))
  check_accuracy(task, df, correct)
}

# PILT ------------------------------------------------------------------------
pilt_raw <- task_df$PILT
pilt <- split_card_choosing(pilt_raw, "pilt")
pilt_missed <- pilt$response %in% "noresp"
check_columns("PILT", pilt,
  c("participant_id", "session", "trialphase", "block", "trial", "response", "rt",
    "response_optimal", "optimal_right", "feedback_left", "feedback_right",
    "stimulus_left", "stimulus_right", "chosen_stimulus", "chosen_feedback"),
  "dashboard pilt_wm.R / PILT_modeling", allow_missing = list(rt = pilt_missed, chosen_stimulus = pilt_missed))
add_check("PILT", "main-task rows after split_card_choosing", nrow(pilt) > 0, sprintf("%d rows", nrow(pilt)))
add_check("PILT", "`block` integer-valued (practice excluded)", all(pilt$block == as.integer(pilt$block)),
          paste("blocks:", paste(sort(unique(pilt$block)), collapse = " ")))
add_check("PILT", "derived block `valence` (from feedback signs)", all(!is.na(pilt$valence)),
          paste(names(table(pilt$valence)), table(pilt$valence), sep = "=", collapse = ", "))
check_values("PILT", pilt, "response", c("left", "right", "noresp"))
check_choice_accuracy("PILT", pilt)

# PILT test -------------------------------------------------------------------
test_raw <- task_df$post_PILT_test
pilt_test <- split_card_choosing(test_raw, "pilt_test")
pit_test <- test_raw |> filter(trialphase == "pilt_test", block == "pavlovian")
check_columns("PILT test", pilt_test,
  c("participant_id", "session", "trialphase", "block", "trial", "response", "rt", "optimal_right", "response_optimal",
    "stimulus_left", "stimulus_right", "EV_left", "EV_right", "same_valence",
    "same_block", "original_block_left", "original_block_right"),
  "PILT_modeling data_prep.R / test-phase plots", allow_missing = list(rt = pilt_test$response %in% "noresp"))
n_test <- pilt_test |> count(participant_id, session)
add_check("PILT test", "≤ 60 non-Pavlovian test trials per session (PILT_modeling assert)",
          nrow(n_test) == n_participants && all(n_test$n <= 60),
          paste("n per participant:", paste(n_test$n, collapse = ", ")))
add_check("PILT test", "Pavlovian (PIT test) block present for each participant",
          n_distinct(pit_test$participant_id) == n_participants,
          sprintf("%d rows with block == 'pavlovian'", nrow(pit_test)))
check_values("PILT test", pilt_test, "response", c("left", "right", "noresp"))
check_choice_accuracy("PILT test", test_raw |> filter(trialphase == "pilt_test"))
learn_stims <- unique(basename(c(pilt$stimulus_left, pilt$stimulus_right)))
test_stims <- unique(basename(c(pilt_test$stimulus_left, pilt_test$stimulus_right)))
missing_stims <- setdiff(test_stims, learn_stims)
add_check("PILT test", "test stimuli all appeared in PILT learning (basename match)",
          length(missing_stims) == 0,
          if (length(missing_stims)) paste("not in PILT:", paste(head(missing_stims, 5), collapse = ", "))
          else sprintf("%d test stimuli matched", length(test_stims)))

# Reversal ----------------------------------------------------------------------
rev_raw <- task_df$reversal |> filter(trial_type == "reversal")
rev_missed <- is.na(rev_raw$response)
check_columns("Reversal", rev_raw,
  c("participant_id", "session", "trial_type", "block", "trial", "response", "rt",
    "response_optimal", "optimal_right", "feedback_left", "feedback_right", "chosen_feedback"),
  "dashboard reversal.R", allow_missing = list(response = rev_missed, rt = rev_missed, response_optimal = rev_missed))
reversal <- preprocess_reversal(rev_raw)
starts <- rev_raw |> group_by(participant_id, block) |> summarise(first = min(trial), .groups = "drop")
add_check("Reversal", "`trial` restarts at 1 in every block", all(starts$first == 1),
          sprintf("%d blocks checked", nrow(starts)))
check_values("Reversal", rev_raw, "response", c("left", "right", NA))
check_choice_accuracy("Reversal", rev_raw)

# GNG -------------------------------------------------------------------------
gng_raw <- task_df$go_no_go |> filter(trialphase == "go_no_go")
check_columns("GNG", gng_raw,
  c("participant_id", "session", "trialphase", "block", "trial", "cue", "cue_id",
    "valence", "affect", "sham", "correct_response", "condition", "response", "rt",
    "correct", "outcome", "outcome_correct", "outcome_incorrect", "face_model"),
  "GNG analysis (P(go) by valence x action, affect, bonus)", allow_missing = list(rt = gng_raw$response %in% "nogo"))
gng <- prepare_gng(gng_raw)
check_values("GNG", gng_raw, "response", c("go", "nogo"))
check_values("GNG", gng_raw, "valence", c("win", "avoid_loss"))
check_values("GNG", gng_raw, "correct_response", c("go", "nogo"))
add_check("GNG", "`correct` == (response == correct_response)",
          is.logical(gng_raw$correct) && all(gng$correct == (gng$response == gng$correct_response)), "")
check_accuracy("GNG", gng, gng$response == gng$correct_response)
add_check("GNG", "`outcome` matches outcome_correct / outcome_incorrect",
          all(gng$outcome == ifelse(gng$correct, gng$outcome_correct, gng$outcome_incorrect)), "")
add_check("GNG", "go trials have rt, no-go trials have none",
          all(!is.na(gng$rt[gng$go])) && all(is.na(gng$rt[!gng$go])), "")
cond_map <- gng |> distinct(condition, valence, correct_response) |> arrange(condition)
add_check("GNG", "`condition` maps one-to-one onto valence x correct_response",
          nrow(cond_map) == 4 && n_distinct(cond_map$condition) == 4,
          paste(sprintf("%s=%s/%s", cond_map$condition, cond_map$valence, cond_map$correct_response),
                collapse = ", "))
# The study schedule has two blocks of 120 trials per participant (GNG trial1.js).
expected_gng_trials <- expand_grid(
  participant_id = sprintf("REL-SIM-%04d", seq_len(n_participants)), block = 1:2, trial = 1:120
)
recorded_gng_trials <- gng |> count(participant_id, block, trial)
missing_gng_trials <- anti_join(expected_gng_trials, recorded_gng_trials, by = c("participant_id", "block", "trial"))
extra_gng_trials <- anti_join(recorded_gng_trials, expected_gng_trials, by = c("participant_id", "block", "trial"))
duplicate_gng_trials <- sum(recorded_gng_trials$n - 1)
add_check("GNG", "each participant recorded all 120 trials in both blocks exactly once",
          nrow(missing_gng_trials) == 0 && nrow(extra_gng_trials) == 0 && duplicate_gng_trials == 0,
          sprintf("%d missing, %d unexpected, %d repeated", nrow(missing_gng_trials),
                  nrow(extra_gng_trials), duplicate_gng_trials))
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
  sprintf("Generated %s from `validation/sim-data/%s/` (%d files).",
          format(Sys.time(), "%Y-%m-%d %H:%M"), manifest$run, length(files)),
  "",
  sprintf("- Simulated participants per task: %s",
          paste(sprintf("%s = %d", names(by_task), lengths(by_task)), collapse = ", ")),
  sprintf("- Simulated participant accuracy (`sim_accuracy`): %s", paste(sim_accuracy, collapse = ", ")),
  sprintf("- Session: `%s` (session_number %d). In real data `session` and `module_start_time` come from the REDCap record.",
          session, manifest$session_number),
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
