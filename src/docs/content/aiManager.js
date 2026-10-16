// Docs: AI Manager (/ai-manager) — train and test the in-house machine-learning models.
export default {
    id: 'ai-manager',
    title: 'AI Manager',
    route: '/ai-manager',
    summary: 'Trains the app\'s own machine-learning models on past prices — a classic "static" model and a reinforcement-learning (RL) agent — and backtests them. These are separate from the Claude/Gemini AI that confirms trades. Training is slow, runs in the background, and can be stopped and resumed.',
    sections: [
        {
            id: 'overview',
            title: 'Two kinds of model',
            md: `- **Static Model** — learns from history to score each signal (how likely it is to work). Strategies can use it as a filter: the **Internal ML model filter** in [Backtest](backtest#ai-options) skips signals it scores low.
- **RL Agent** (the default tab) — a reinforcement-learning agent learns *by trial and error* in a simulated market which action to take on each candle (buy, sell, hold, how big). It powers the RL strategy.

The dot next to the title says whether a model is available: **RL Model Available / No RL Model Saved** or **Model Active / No Model Loaded**. A pulsing badge counts training jobs in progress.

> **Warning:** A model that scores well on the period it was trained on proves nothing — it has seen the answers. Judge a model only on the backtest of a period **after** its training data ends ([out of sample](basics#backtest-oos)).`,
        },
        {
            id: 'static',
            title: 'Static Model',
            md: `Pick a **Symbol**, the **Start / End Date** of the training data and **Epochs** (how many passes over the data). **Training Results** show **Accuracy** (share of correct calls), **F1 Score** (a balance of catching good signals and avoiding false ones; 1 is perfect), iterations and loss (the training error — lower is better).`,
        },
        {
            id: 'rl',
            title: 'RL Agent — training settings',
            md: `| Setting | Meaning |
|---|---|
| **Symbol** | Index, stock or MCX commodity to learn on. |
| **Engine** | **Standard** (SB3 · PyTorch, CPU) or **Nitro** (JAX on a GPU, many simulations in parallel — **Parallel Envs** × **Steps / Env**). |
| **Timesteps** | How many decisions the agent practises. More = longer and (up to a point) better. |
| **Window Size** | How many past candles the agent sees at each decision. |
| **Intraday Mode** | Positions are closed every day (on automatically for MCX). |
| **Broker / Data Source / Timeframe** | Where the training candles come from and their size. **ARCHIVE** uses stored history. |
| **Custom Model Name** | Your label for the saved model. |
| **Feature Profile** | Which set of inputs the agent sees — from **Lean** (61 core indicators, best signal-to-noise) to **Comprehensive** (117). More inputs is not better: noise drowns the signal. |
| **Base Model** | Continue training from an existing model instead of starting fresh. |

**Advanced Hyperparameters** tune the learning itself: learning rate start/end, PPO epochs, **Gamma** (how far ahead the agent cares — lower suits quick scalps, higher suits multi-hour trades), **GAE Lambda**, the **entropy schedule** (how much it explores, phase by phase), the **curriculum split** (easy → hard phases), exit cooldown and an optional extra-data CSV. Leave them at their defaults unless you know why you are changing them.

You can launch several jobs at once; each runs in its own process.`,
        },
        {
            id: 'jobs',
            title: 'Training jobs and resumable training',
            md: `**Training Jobs** lists active and recent jobs with progress. **Logs** shows a job's output; **Stop** stops it and **saves the model so far**. **Resumable Training** lists checkpoints of jobs that stopped part-way — resume one to continue from where it left off rather than starting again.`,
        },
        {
            id: 'models',
            title: 'Saved RL models',
            md: `Every trained agent: name and symbol, the **data range** it learned on, its **Action Bias** (how often it chooses buy / sell / hold — an agent that almost always holds, or always buys, has probably learned nothing useful) and **Size/Action** (average position size it picks). **Delete** removes a model.`,
        },
        {
            id: 'backtest',
            title: 'AI Backtest',
            md: `Run a trained model over a period:

- **Standard AI** — fixed risk per trade; the model only filters which trades are taken.
- **Adaptive Risk** — target and stop scale with the model's confidence (**Enable Dynamic TP/SL Scaling**).
- **Confidence Threshold** — ignore predictions below this confidence.

**Backtest Performance** shows **Total Return**, **Win Rate**, **Trades** and **Drawdown**. Always test on dates after the model's data range.`,
        },
    ],
};
