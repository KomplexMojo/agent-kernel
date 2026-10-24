# Playtesting Deepward

Thanks for testing. You need a Mac or a Linux computer, a terminal window, and about ten minutes for the first setup.

## 1. Get access (the game is private)

The repository is **private**, so before anything else:

1. Send Darren your GitHub username. If you have no GitHub account, make a free one at <https://github.com/signup>.
2. Darren adds you as a collaborator. Accept the invite from the email, or at <https://github.com/KomplexMojo/agent-kernel/invitations>.
3. Let git sign in to GitHub. The simplest way: install the GitHub CLI from <https://cli.github.com>, run `gh auth login`, and answer **yes** to "Authenticate Git with your GitHub credentials?".

## 2. Run the setup script

Darren sends you `tester-setup.sh` (or, once step 1 is done, download it with the GitHub CLI). Open a terminal in the folder where you saved it and run:

```bash
bash tester-setup.sh
```

Or download and run it in one line (needs step 1 done):

```bash
gh api repos/KomplexMojo/agent-kernel/contents/scripts/game/tester-setup.sh -H "Accept: application/vnd.github.raw" > tester-setup.sh && bash tester-setup.sh
```

The script:

- checks for **git** (on a Mac it opens the Command Line Tools installer if git is missing),
- checks for **Node 22.18 or newer**, and installs Node 22 for your user account through nvm if needed (no admin password),
- gets **pnpm** (the package manager) without installing anything system-wide,
- downloads the game into `~/deepward` (or updates it if it is already there),
- installs the game's packages,
- lists the test scenarios and asks which one to play.

It is safe to run again: each run updates the game to the latest version first. To play later, run `bash ~/deepward/scripts/game/tester-setup.sh`.

## 3. Play the scenarios

Pick a scenario by name (press Enter for `first-look`, which is the place to start): `first-look`, `fields`, `duel`, `traits`, `party`, `tactics`, `long-haul`. Each one prints what to try. Note the **turn number** (bottom of the screen) when something looks wrong.

Quit a game with `q`. You are then asked what you noticed: type one finding per line, and press Enter on an empty line to finish. After that you can pick another scenario, or type `q` to finish.

## 4. Send your reports back

Every game you quit writes a `report.md` under `~/deepward/artifacts/playtest/`; the script lists them when you finish. Send Darren those files (attach them, or zip the `playtest` folder). Each report records the exact version and your moves, so Darren can replay your game turn by turn.

## If something goes wrong

- **"Could not download the game"**: you have not accepted the invite yet, or git is not signed in to GitHub (see step 1).
- **Anything else**: copy the last lines of the terminal and send them to Darren.
