# Functions copied from the RELMED behaviour dashboard
# (github.com/huyslab/relmed_analysis_behaviour @ 94e68f1), so the simulated-data
# checks exercise the same preprocessing and plots the dashboard runs on real data.
#
# Changes from the originals, kept minimal:
#   - patchwork is not required: by-block curves use facet_grid instead of one panel per session.
#   - add_status() / status_scales() / add_site() are dropped: every simulated participant
#     is drawn the same way.
#   - fix_session_order() is reduced to the factor recode it does in data_helpers.R.
#
# Sources:
#   split_card_choosing             core/R/preprocessing/load_data.R
#   fix_session_order               core/R/preprocessing/data_helpers.R
#   plot_pilt_learning_curves,
#   plot_pilt_learning_curves_by_block   projects/behaviour-dashboard/R/tasks/pilt_wm.R
#   preprocess_reversal,
#   plot_reversal_accuracy          projects/behaviour-dashboard/R/tasks/reversal.R
#   summarise_two_stage, plot_status_lines, integer_breaks, theme_dashboard
#                                   projects/behaviour-dashboard/R/utils.R

suppressPackageStartupMessages({
  library(dplyr)
  library(ggplot2)
})

SESSION_LEVELS <- c("screening", "wk0", "wk2", "wk4", "wk6", "wk8", "wk24", "wk28", "wk52")

fix_session_order <- function(df) {
  df |> mutate(session = factor(as.character(session), levels = SESSION_LEVELS, ordered = TRUE))
}

# ---- utils.R -------------------------------------------------------------

integer_breaks <- function(n = 6) {
  function(x) {
    b <- pretty(x, n = n)
    b[b == floor(b)]
  }
}

theme_dashboard <- function() {
  theme_classic(base_size = 14) +
    theme(
      strip.background = element_blank(),
      strip.text = element_text(size = 12),
      legend.position = "top",
      legend.title = element_text(size = 11),
      legend.text = element_text(size = 10),
      axis.line = element_line(linewidth = 0.8)
    )
}

summarise_two_stage <- function(df, id_col, x_col, y_col, group_cols = character(0)) {
  stage1 <- c(id_col, group_cols, x_col)
  stage2 <- c(group_cols, x_col)

  indiv <- df |>
    group_by(across(all_of(stage1))) |>
    summarise(y = mean(.data[[y_col]], na.rm = TRUE), .groups = "drop")

  group_summ <- indiv |>
    group_by(across(all_of(stage2))) |>
    summarise(
      mean = mean(y, na.rm = TRUE),
      se   = sd(y, na.rm = TRUE) / sqrt(sum(!is.na(y))),
      .groups = "drop"
    ) |>
    mutate(lb = mean - se, ub = mean + se)

  list(indiv = indiv, group = group_summ)
}

plot_status_lines <- function(df, x_col, y_col, id_col = "participant_id",
                              facet_col = "session", x_lab = x_col, y_lab = y_col) {
  indiv <- summarise_two_stage(df, id_col, x_col, y_col, group_cols = facet_col)$indiv
  group <- summarise_two_stage(df, id_col, x_col, y_col, group_cols = facet_col)$group

  ggplot() +
    geom_line(data = indiv,
              aes(x = .data[[x_col]], y = y, group = .data[[id_col]]),
              colour = "steelblue", alpha = 0.5, linewidth = 0.4) +
    geom_line(data = group, aes(x = .data[[x_col]], y = mean, group = 1),
              colour = "grey20", linewidth = 1.5) +
    facet_wrap(vars(.data[[facet_col]])) +
    labs(x = x_lab, y = y_lab) +
    theme_dashboard()
}

# ---- load_data.R ----------------------------------------------------------

split_card_choosing <- function(df, task_name = "pilt", id_col = "participant_id") {
  out <- df |>
    filter(!is.na(trialphase), trialphase == task_name) |>
    filter(task_name == "pit_test" | !is.na(suppressWarnings(as.numeric(block))) &
             suppressWarnings(as.numeric(block)) == suppressWarnings(as.integer(block))) |>
    mutate(block = as.integer(block)) |>
    arrange(.data[[id_col]], session, block, trial) |>
    select(where(~ !all(is.na(.))))

  if (task_name == "pilt") {
    stim_fb <- bind_rows(
      out |> select(session, block, trial, feedback = feedback_right, stimulus = stimulus_right),
      out |> select(session, block, trial, feedback = feedback_left, stimulus = stimulus_left)
    ) |>
      mutate(stimulus = sub("^.*/stimuli/", "", stimulus)) |>
      distinct()

    common_fb <- stim_fb |>
      group_by(session, block, stimulus) |>
      summarise(
        common_feedback = as.numeric(names(sort(table(feedback), decreasing = TRUE)[1])),
        n_feedback_types = n_distinct(feedback),
        .groups = "drop"
      )

    valence <- common_fb |>
      group_by(session, block) |>
      summarise(
        valence = case_when(
          all(common_feedback > 0) ~ "Reward",
          all(common_feedback < 0) ~ "Punishment",
          TRUE ~ "Mixed"
        ),
        .groups = "drop"
      )

    out <- out |>
      select(-any_of("valence")) |>
      left_join(valence, by = c("session", "block"))
  }

  out
}

# ---- pilt_wm.R ------------------------------------------------------------

plot_pilt_learning_curves <- function(df, id_col = "participant_id") {
  df <- df |> filter(response != "noresp") |> fix_session_order()

  plot_status_lines(df, "trial", "response_optimal", id_col = id_col,
                    x_lab = "Trial #", y_lab = "Prop. optimal choice") +
    geom_vline(xintercept = 5, colour = "grey50", linetype = "dashed") +
    scale_x_continuous(breaks = integer_breaks()) +
    scale_y_continuous(breaks = seq(0, 1, 0.25))
}

plot_pilt_learning_curves_by_block <- function(df, id_col = "participant_id", colour_by = "valence") {
  df <- df |> filter(response != "noresp") |> fix_session_order()

  stim_fb <- bind_rows(
    df |> select(session, block, trial, feedback = feedback_right, stimulus = stimulus_right),
    df |> select(session, block, trial, feedback = feedback_left, stimulus = stimulus_left)
  ) |> distinct()

  block_labels <- stim_fb |>
    group_by(session, block, stimulus) |>
    summarise(feedbacks = list(unique(feedback)), .groups = "drop") |>
    group_by(session, block) |>
    summarise(label = paste0(block[1], "\n", paste(sort(unique(unlist(feedbacks))), collapse = " v. ")),
              .groups = "drop")

  df <- df |> left_join(block_labels, by = c("session", "block"))

  stages <- summarise_two_stage(df, id_col, "trial", "response_optimal",
                                group_cols = c("session", "block", "label", colour_by))
  g_data <- stages$group |>
    arrange(block) |>
    mutate(label = factor(label, levels = unique(label)))

  ggplot(g_data) +
    geom_ribbon(aes(x = trial, ymin = lb, ymax = ub, fill = .data[[colour_by]]), alpha = 0.2) +
    geom_line(aes(x = trial, y = mean, colour = .data[[colour_by]]), linewidth = 1.5) +
    geom_vline(xintercept = 5, colour = "grey50", linetype = "dashed") +
    facet_wrap(vars(label), ncol = 5) +
    scale_x_continuous(breaks = integer_breaks()) +
    scale_y_continuous(breaks = seq(0, 1, 0.25)) +
    labs(x = "Trial #", y = "Prop. optimal choice", colour = colour_by, fill = colour_by) +
    theme_dashboard()
}

# ---- reversal.R -----------------------------------------------------------

preprocess_reversal <- function(df, id_col = "participant_id") {
  df |>
    filter(!is.na(response_optimal)) |>
    arrange(.data[[id_col]], session, block, trial) |>
    group_by(.data[[id_col]], session) |>
    mutate(ctrial = row_number()) |>
    ungroup() |>
    group_by(.data[[id_col]], session, block) |>
    mutate(trial_pre_reversal = trial - max(trial) - 1L) |>
    ungroup() |>
    group_by(.data[[id_col]], session) |>
    mutate(n_blocks = max(block)) |>
    ungroup() |>
    mutate(
      feedback_optimal    = ifelse(optimal_right == 1, feedback_right, feedback_left),
      feedback_suboptimal = ifelse(optimal_right == 0, feedback_right, feedback_left)
    ) |>
    fix_session_order()
}

plot_reversal_accuracy <- function(df, id_col = "participant_id") {
  pre <- df |>
    filter(trial_pre_reversal > -4, block < n_blocks, trial < 48) |>
    group_by(across(all_of(c(id_col, "session", "trial_pre_reversal")))) |>
    summarise(acc = mean(response_optimal, na.rm = TRUE), .groups = "drop") |>
    rename(trial = trial_pre_reversal)

  post <- df |>
    filter(trial < 6) |>
    group_by(across(all_of(c(id_col, "session", "trial")))) |>
    summarise(acc = mean(response_optimal, na.rm = TRUE), .groups = "drop")

  indiv <- bind_rows(pre, post) |> mutate(segment = sign(trial))

  grp <- indiv |>
    group_by(session, trial) |>
    summarise(
      mean    = mean(acc, na.rm = TRUE),
      se      = sd(acc, na.rm = TRUE) / sqrt(sum(!is.na(acc))),
      segment = first(sign(trial)),
      .groups = "drop"
    ) |>
    mutate(lb = mean - se, ub = mean + se)

  ggplot() +
    geom_line(data = indiv,
              aes(x = trial, y = acc, group = interaction(.data[[id_col]], segment)),
              colour = "steelblue", alpha = 0.5, linewidth = 0.4) +
    geom_errorbar(data = grp, aes(x = trial, ymin = lb, ymax = ub),
                  colour = "grey20", linewidth = 1, width = 0.3) +
    geom_point(data = grp, aes(x = trial, y = mean), colour = "grey20", size = 3) +
    geom_line(data = grp, aes(x = trial, y = mean, group = segment), colour = "grey20", linewidth = 1.5) +
    geom_vline(xintercept = 0, colour = "grey50", linetype = "dashed") +
    facet_wrap(vars(session)) +
    scale_x_continuous(breaks = -3:5) +
    scale_y_continuous(breaks = seq(0, 1, 0.25), limits = c(0, 1)) +
    labs(x = "Trial relative to reversal", y = "Prop. optimal choice") +
    theme_dashboard()
}
