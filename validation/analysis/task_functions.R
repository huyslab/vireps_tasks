# Analyses with no dashboard counterpart: the post-PILT test phase and the
# go/no-go "people game". Kept deliberately simple: they check the recorded
# variables support the analyses we expect to run.

suppressPackageStartupMessages({
  library(dplyr)
  library(ggplot2)
})

# ---- PILT test -------------------------------------------------------------

prepare_pilt_test <- function(df) {
  df |>
    filter(response %in% c("left", "right")) |>
    mutate(
      ev_diff = EV_right - EV_left,
      chose_right = response == "right",
      chose_higher_ev = ifelse(ev_diff == 0, NA, (ev_diff > 0) == chose_right),
      abs_ev_bin = cut(abs(ev_diff), breaks = c(0, 0.25, 0.5, 1, Inf), include.lowest = TRUE)
    )
}

plot_pilt_test_by_ev <- function(df, id_col = "participant_id") {
  d <- df |> filter(!is.na(chose_higher_ev))
  stages <- summarise_two_stage(d, id_col, "abs_ev_bin", "chose_higher_ev",
                                group_cols = "same_valence")
  ggplot(stages$group, aes(x = abs_ev_bin, y = mean, colour = factor(same_valence),
                           group = factor(same_valence))) +
    geom_hline(yintercept = 0.5, linetype = "dashed", colour = "grey50") +
    geom_pointrange(aes(ymin = lb, ymax = ub), position = position_dodge(0.3)) +
    geom_line(position = position_dodge(0.3)) +
    scale_y_continuous(limits = c(0, 1)) +
    labs(x = "|EV right − EV left|", y = "P(choose higher EV)", colour = "Same valence") +
    theme_dashboard()
}

# ---- Go/no-go ---------------------------------------------------------------

prepare_gng <- function(df) {
  df |>
    mutate(
      go = response == "go",
      correct = as.logical(correct),
      cond_label = paste(ifelse(valence == "win", "Win", "Avoid loss"),
                         ifelse(correct_response == "go", "go", "no-go"), sep = " / "),
      trial_bin = ceiling(trial / 20)
    )
}

# The classic 2x2: P(go) for go-to-win, go-to-avoid, nogo-to-win, nogo-to-avoid.
plot_gng_pgo_2x2 <- function(df, id_col = "participant_id") {
  stages <- summarise_two_stage(df, id_col, "correct_response", "go", group_cols = "valence")
  ggplot(stages$group, aes(x = correct_response, y = mean, fill = valence)) +
    geom_col(position = position_dodge(0.8), width = 0.7) +
    geom_errorbar(aes(ymin = lb, ymax = ub), position = position_dodge(0.8), width = 0.2) +
    geom_point(data = stages$indiv, aes(y = y, group = valence),
               position = position_jitterdodge(jitter.width = 0.1, dodge.width = 0.8),
               size = 1, alpha = 0.6, show.legend = FALSE) +
    scale_y_continuous(limits = c(0, 1)) +
    labs(x = "Correct response", y = "P(go)", fill = "Valence") +
    theme_dashboard()
}

plot_gng_learning <- function(df, id_col = "participant_id") {
  stages <- summarise_two_stage(df, id_col, "trial_bin", "go", group_cols = c("block", "cond_label"))
  ggplot(stages$group, aes(x = trial_bin, y = mean, colour = cond_label, fill = cond_label)) +
    geom_ribbon(aes(ymin = lb, ymax = ub), alpha = 0.15, colour = NA) +
    geom_line(linewidth = 1.2) +
    facet_wrap(vars(block), labeller = label_both) +
    scale_y_continuous(limits = c(0, 1)) +
    labs(x = "Trial bin (20 trials)", y = "P(go)", colour = NULL, fill = NULL) +
    theme_dashboard()
}

plot_gng_accuracy_by_affect <- function(df, id_col = "participant_id") {
  stages <- summarise_two_stage(df, id_col, "affect", "correct", group_cols = "valence")
  ggplot(stages$group, aes(x = affect, y = mean, colour = valence, group = valence)) +
    geom_pointrange(aes(ymin = lb, ymax = ub), position = position_dodge(0.3)) +
    geom_line(position = position_dodge(0.3)) +
    scale_y_continuous(limits = c(0, 1)) +
    labs(x = "Face affect", y = "P(correct)", colour = "Valence") +
    theme_dashboard()
}

plot_gng_cumulative_outcome <- function(df, id_col = "participant_id") {
  d <- df |>
    arrange(.data[[id_col]], block, trial) |>
    group_by(.data[[id_col]]) |>
    mutate(cum_outcome = cumsum(outcome), ctrial = row_number()) |>
    ungroup()
  ggplot(d, aes(x = ctrial, y = cum_outcome, colour = .data[[id_col]])) +
    geom_line() +
    labs(x = "Trial", y = "Cumulative points", colour = NULL) +
    theme_dashboard()
}
