enum Layout {
    Portrait,
    Landscape
}

export class ScreenManager {
    private static instance: ScreenManager;
    private gameWidth: number = 1024;
    private gameHeight: number = 768;
    private scale: Phaser.Scale.ScaleManager | null = null;
    private detectLayout(): Layout {
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (w > h) {
            return Layout.Landscape;
        } else {
            return Layout.Portrait;
        }
    }

    private constructor() {}

    public static getInstance(): ScreenManager {
        if (!ScreenManager.instance) {
            ScreenManager.instance = new ScreenManager();
        }
        return ScreenManager.instance;
    }

    public initialize(scale: Phaser.Scale.ScaleManager): void {
        this.scale = scale;
        this.setupScaling();
    }

    private setupScaling(): void {
        if (!this.scale) return;

        // Determine layout and apply profile
        let currentLayout = this.detectLayout();
        const width = window.innerWidth;
        const height = window.innerHeight;

        //console.log(`Layout selected: ${Layout[currentLayout]} ${width} x ${height}`);

        // Set game size to match screen dimensions
        this.scale.setGameSize(width, height);
        this.scale.autoCenter = Phaser.Scale.CENTER_BOTH;

        // For portrait mode, ensure we're using the full height
        if (currentLayout === Layout.Portrait) {
            // In portrait mode, we want to take up the full height of the screen
            // Calculate the width that maintains the game's aspect ratio at full height
            const gameAspectRatio = this.gameWidth / this.gameHeight;
            const newWidth = height * gameAspectRatio;
            
            // If the calculated width is less than the screen width, we need to adjust
            if (newWidth < width) {
                // Set the game size to use the full height and calculated width
                this.scale.setGameSize(newWidth, height);
                // console.log(`Adjusted portrait mode width to ${newWidth} to maintain aspect ratio at full height`);
            } else {
                // If the calculated width is greater than the screen width, we need to adjust the height
                // In portrait mode, we want to take up the full height regardless of aspect ratio
                this.scale.setGameSize(width, height);
                // console.log(`Using full height in portrait mode: ${height}`);
            }
        }

        // Attempt automatic fullscreen on mobile devices
        if (/Mobi|Android/i.test(navigator.userAgent) && this.scale.fullscreen.available) {
            this.scale.startFullscreen();
        }

        // Listen for size/orientation changes to switch layouts
        window.addEventListener('resize', () => {
            const newLayout = this.detectLayout();
            if (newLayout !== currentLayout) {
                currentLayout = newLayout;
                const width = window.innerWidth;
                const height = window.innerHeight;
                if(this.scale) {
                    this.scale.setGameSize(width, height);
                    
                    // Apply the same portrait mode adjustments on resize
                    if (newLayout === Layout.Portrait) {
                        const gameAspectRatio = this.gameWidth / this.gameHeight;
                        const newWidth = height * gameAspectRatio;
                        
                        if (newWidth < width) {
                            this.scale.setGameSize(newWidth, height);
                        } else {
                            // In portrait mode, we want to take up the full height regardless of aspect ratio
                            this.scale.setGameSize(width, height);
                        }
                    }
                    
                    this.scale.refresh();
                }
            }
        });
    }

    public getGameWidth(): number {
        return this.gameWidth;
    }

    public getGameHeight(): number {
        return this.gameHeight;
    }

    public getScreenWidth(): number {
        return this.scale?.width || window.innerWidth;
    }

    public getScreenHeight(): number {
        return this.scale?.height || window.innerHeight;
    }

    public getScaleRatio(): number {
        if (!this.scale) return 1;
        return Math.min(
            this.scale.width / this.gameWidth,
            this.scale.height / this.gameHeight
        );
    }

    public isLandscape(): boolean {
        return this.getScreenWidth() > this.getScreenHeight();
    }

    public isPortrait(): boolean {
        return this.getScreenWidth() < this.getScreenHeight();
    }
}