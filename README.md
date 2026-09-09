# Valorant Scout

> Windows app that automatically loads tracker.gg webpages for your Valorant game.

## Features

- **Overview:** The main 'landing' page for each match is the overview. Since there is no tracker.gg match page while it is playing out, you will see a quick overview for the players on your team and the enemy team, and their ranks and levels, so long as they are public.
- **Players:** At the top you can access tracker.gg pages for each individual player in your match for a greater look at each player.
- **Match Saving:** Matches and the players are automatically saved. You can delete saved matches.
- **Buttons:**
  - **Overview:** Takes you to the match overview as mentioned above.
  - **Back:** Takes you back to the main page of the player or match selected if you accidentally clicked off.
  - **Sync:** Re-syncs your Valorant and Valorant Scout if it hasn't yet loaded.
  - **Delete Match:** Deletes the currently selected match from your save file.

## Getting Started

### Prerequisites

Node.js >= 22.12.0

### Installation

```bash
git clone https://github.com/RedNinja17/valorant-scout.git # Clone GitHub repository into folder.
cd valorant-scout # Go into the directory.
npm install # Install dependencies
```

## Usage

### Testing
```bash
npm start # Run the application.
```
### Downloading
```bash
npm run dist # Start compiling the .exe
```
Then look inside the new 'dist' folder for **insert name of file**. Run the installer for the application.
When a new version comes out, run the aforementioned command again and re-run the installer. the same .exe is used so taskbar or desktop pins save.


## License
Not endorsed by Riot Games. Riot Games and VALORANT are trademarks of Riot Games, Inc.

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
