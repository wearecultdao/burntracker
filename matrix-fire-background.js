(function () {
    const canvas = document.getElementById('matrix-fire-background');
    if (!canvas) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
        canvas.style.display = 'none';
        return;
    }

    const ctx = canvas.getContext('2d');
    const letters = 'CULTDAOABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const fontSize = 9;
    const frameInterval = 38;
    const flames = [];
    const sparks = [];

    let maxFlames = 0;
    let columns = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastDrawTime = 0;
    let animationId = null;
    let wind = 0;
    let gustWind = 0;
    let targetGustWind = 0;
    let windTimer = 0;
    let windForce = 0;

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        columns = Math.ceil(width / fontSize);
        rows = Math.ceil(height / fontSize);
        initializeFlames();
    }

    function randomLetter() {
        return letters[Math.floor(Math.random() * letters.length)];
    }

    function updateWind() {
        if (windTimer > 0) {
            windTimer -= 1;
        } else if (Math.random() > 0.985) {
            targetGustWind = randomBetween(-4.8, 4.8);
            windTimer = Math.floor(randomBetween(70, 170));
        } else {
            targetGustWind *= 0.94;
            if (Math.abs(targetGustWind) < 0.04) targetGustWind = 0;
        }

        gustWind += (targetGustWind - gustWind) * 0.055;
        const breeze = Math.sin(frame * 0.018) * 0.9 + Math.sin(frame * 0.006 + 1.7) * 0.65;
        wind = breeze + gustWind;
        windForce = Math.min(1, Math.abs(gustWind) / 4.8 + Math.abs(breeze) / 9);
    }

    function heatColor(heat, alpha) {
        const flicker = randomBetween(-0.08, 0.08);
        const value = Math.max(0, Math.min(1, heat + flicker));

        if (value > 0.86) return `rgba(255, 232, 164, ${alpha})`;
        if (value > 0.68) return `rgba(255, 174, 82, ${alpha})`;
        if (value > 0.42) return `rgba(255, 82, 78, ${alpha})`;
        if (value > 0.2) return `rgba(165, 35, 32, ${alpha})`;
        return `rgba(76, 18, 18, ${alpha})`;
    }

    function initializeFlames() {
        flames.length = 0;
        sparks.length = 0;

        const flameCount = Math.min(68, Math.max(36, Math.floor(columns * 0.42)));
        maxFlames = Math.min(96, Math.max(flameCount + 14, Math.floor(columns * 0.62)));
        for (let i = 0; i < flameCount; i += 1) {
            const flame = {};
            resetFlame(flame, true);
            flames.push(flame);
        }
    }

    function resetFlame(flame, scatter = false) {
        const reach = Math.random();
        const tall = reach > 0.84;
        const medium = reach > 0.42;
        const wide = tall || Math.random() > 0.56;
        const targetHeight = tall
            ? randomBetween(rows * 0.42, rows * 0.78)
            : medium
                ? randomBetween(rows * 0.18, rows * 0.38)
                : randomBetween(rows * 0.07, rows * 0.2);

        flame.column = Math.floor(Math.random() * columns);
        flame.phase = Math.random() * Math.PI * 2;
        flame.speed = randomBetween(0.07, 0.17);
        flame.height = scatter ? randomBetween(5, targetHeight) : targetHeight * 0.5;
        flame.targetHeight = targetHeight;
        flame.width = tall
            ? randomBetween(3.2, 8.2)
            : wide
                ? randomBetween(2.3, 6.2)
                : randomBetween(1.3, 3.6);
        flame.baseBulge = tall
            ? randomBetween(1.55, 3.35)
            : wide
                ? randomBetween(1.25, 2.85)
                : randomBetween(1, 1.9);
        flame.lean = randomBetween(-0.035, 0.035);
        flame.curlSpeed = randomBetween(0.72, 1.48);
        flame.curlRow = randomBetween(0.16, 0.42);
        flame.curlStrength = randomBetween(0.42, 1.35);
        flame.curlBias = randomBetween(-0.55, 0.55);
        flame.flickerPhase = Math.random() * Math.PI * 2;
        flame.heat = randomBetween(0.72, 1);
        flame.life = Math.floor(tall
            ? randomBetween(180, 380)
            : medium
                ? randomBetween(115, 260)
                : randomBetween(70, 175));
        flame.age = scatter ? randomBetween(0, flame.life) : 0;
        flame.growEnd = randomBetween(0.22, tall ? 0.48 : 0.58);
        flame.holdEnd = Math.min(0.9, flame.growEnd + randomBetween(tall ? 0.18 : 0.08, tall ? 0.42 : 0.28));
        flame.reigniteAt = randomBetween(0.66, 0.88);
        flame.childStarted = false;
        flame.collapseDepth = randomBetween(0.42, tall ? 0.72 : 0.82);
        flame.collapseWobble = randomBetween(1.2, 3.2);
        flame.split = tall || Math.random() > 0.58;
        flame.splitSide = Math.random() > 0.5 ? 1 : -1;
        flame.tall = tall;
    }

    function spawnFlameNear(parent) {
        if (flames.length >= maxFlames) return;

        const child = {};
        resetFlame(child);
        child.column = Math.max(0, Math.min(columns - 1, parent.column + Math.floor(randomBetween(-3, 4))));
        child.height = randomBetween(2, Math.max(4, parent.height * 0.24));
        child.width = Math.max(child.width, parent.width * randomBetween(0.65, 1.18));
        child.baseBulge = Math.max(child.baseBulge, parent.baseBulge * randomBetween(0.82, 1.18));
        child.curlBias += parent.curlBias * 0.25;
        child.heat = Math.min(1, parent.heat + randomBetween(-0.08, 0.14));
        flames.push(child);
    }

    function drawFireBed() {
        for (let col = 0; col < columns; col += 1) {
            const wave = (Math.sin(frame * 0.08 + col * 0.23) + 1) * 0.85;
            const clump = Math.random() > 0.8 ? randomBetween(2, 8) : 0;
            const flare = Math.random() > 0.91 ? randomBetween(3, 9) : 0;
            const stackRows = Math.floor(3 + wave + clump + flare + Math.random() * 4);

            for (let row = 0; row < stackRows; row += 1) {
                const progress = row / Math.max(1, stackRows);
                const density = row === 0
                    ? 0.99
                    : row < 3
                        ? 0.995
                        : 0.86 - progress * 0.4;
                if (Math.random() > density) continue;

                const liftedTop = row > 2
                    ? Math.max(0, Math.sin(frame * 0.07 + col * 0.51 + row * 1.7) + randomBetween(-0.65, 0.9)) * fontSize * 0.72
                    : randomBetween(-1, 1);
                const x = col * fontSize + (row > 2 ? randomBetween(-1.8, 1.8) : 0);
                const y = height - (row + 1) * fontSize - liftedTop;
                const heat = (1 - progress) * randomBetween(0.76, 1.22)
                    + (Math.random() > 0.78 ? 0.22 : 0)
                    + windForce * 0.16;
                const alpha = Math.min(1, (0.38 + (1 - progress) * 0.68) * randomBetween(0.64, 1.1) * (1 + windForce * 0.2));

                ctx.fillStyle = heatColor(heat, alpha);
                ctx.shadowColor = row === 0
                    ? `rgba(255, 210, 130, ${0.42 + windForce * 0.16})`
                    : row < 3
                        ? `rgba(255, 112, 74, ${0.22 + windForce * 0.12})`
                        : 'transparent';
                ctx.shadowBlur = row === 0 ? 5 : row < 3 ? 2 : 0;
                ctx.fillText(randomLetter(), x, y);
            }
        }
        ctx.shadowBlur = 0;
    }

    function drawFlame(flame) {
        flame.phase += flame.speed;
        flame.age += 1;

        if (flame.age > flame.life) {
            const oldColumn = flame.column;
            resetFlame(flame);
            flame.column = Math.max(0, Math.min(columns - 1, oldColumn + Math.floor(randomBetween(-5, 6))));
        }

        const lifeProgress = flame.age / flame.life;
        if (!flame.childStarted && lifeProgress > flame.reigniteAt) {
            flame.childStarted = true;
            spawnFlameNear(flame);
        }

        const grow = Math.min(1, lifeProgress / flame.growEnd);
        const collapse = lifeProgress > flame.holdEnd
            ? Math.min(1, (lifeProgress - flame.holdEnd) / Math.max(0.08, 1 - flame.holdEnd))
            : 0;
        const holdPulse = lifeProgress > flame.growEnd && lifeProgress < flame.holdEnd
            ? Math.sin(flame.phase * 1.7) * 0.08
            : 0;
        const heightFactor = (0.24 + grow * 0.88 + holdPulse + windForce * 0.08) * (1 - collapse * flame.collapseDepth);
        const targetNow = Math.max(4, flame.targetHeight * heightFactor);
        flame.height += (targetNow - flame.height) * 0.12;

        const flameRows = Math.max(3, Math.floor(flame.height * (0.88 + Math.sin(flame.phase) * 0.12)));

        for (let row = 0; row < flameRows; row += 1) {
            const progress = row / flameRows;
            const y = height - (row + 2) * fontSize;
            if (y < 0) continue;

            const narrow = Math.pow(1 - progress, 1.18);
            const collapsePull = collapse * progress * 0.56;
            const baseBulge = 1 + Math.pow(1 - progress, 2.1) * (flame.baseBulge - 1);
            const localPhase = flame.phase * flame.curlSpeed + flame.flickerPhase;
            const radius = Math.max(0.3, flame.width * baseBulge * narrow * (0.86 - collapsePull + Math.sin(localPhase + row * flame.curlRow) * 0.2));
            const center = flame.column
                + Math.sin(localPhase + row * flame.curlRow) * flame.width * flame.curlStrength * (0.13 + progress * 0.48)
                + Math.sin(localPhase * 0.47 + row * 0.11) * flame.width * 0.18 * progress
                + flame.curlBias * progress * 1.8
                + wind * progress * (flame.tall ? 1.9 : 1.35)
                + flame.lean * row
                + collapse * Math.sin(localPhase * 1.6 + row * 0.16) * progress * flame.collapseWobble;
            const span = Math.max(1, Math.ceil(radius));

            for (let offset = -span; offset <= span; offset += 1) {
                const distance = Math.abs(offset) / Math.max(0.3, radius);
                const density = Math.max(0, (1 - distance * 0.72) * Math.pow(1 - progress, 0.64) * (1 - collapse * progress * 0.45));
                if (Math.random() > density * (flame.tall ? 0.78 : 0.66)) continue;

                const x = (center + offset) * fontSize;
                const alpha = Math.max(0.06, density * (1 - progress * 0.58) * flame.heat * (1 + windForce * 0.24));
                const upperCool = Math.max(0, progress - 0.28);
                const localHeat = (1 - progress) * randomBetween(0.5, 0.96)
                    + (distance < 0.45 ? 0.18 : 0.02)
                    + (progress < 0.36 && Math.random() > 0.88 ? 0.2 : 0)
                    + windForce * 0.12
                    - upperCool * 0.22;

                ctx.fillStyle = heatColor(localHeat, progress < 0.72 ? alpha : alpha * 0.76);
                ctx.fillText(randomLetter(), x, y);
            }
        }

        if (flame.split && collapse > 0.12 && flameRows > 7) {
            const visibleSplitStart = Math.floor(flameRows * (0.5 + (1 - collapse) * 0.16));
            const detachedStart = Math.max(4, visibleSplitStart);
            const detachedRows = Math.min(5, Math.max(2, Math.floor(flameRows * 0.09)));
            const fade = (1 - collapse) * 0.26;

            for (let row = 0; row < detachedRows; row += 1) {
                const progress = row / Math.max(1, detachedRows);
                const y = height - (detachedStart + row + 2) * fontSize;
                if (y < 0) continue;

                const radius = Math.max(0.35, flame.width * 0.58 * Math.pow(1 - progress, 1.35));
                const localPhase = flame.phase * flame.curlSpeed + flame.flickerPhase;
                const center = flame.column
                    + flame.splitSide * (1.2 + collapse * 3.2 + row * 0.035)
                    + wind * 1.2
                    + Math.sin(localPhase * 1.4 + row * 0.28) * (0.8 + flame.curlStrength * 0.6);
                const span = Math.max(1, Math.ceil(radius));

                for (let offset = -span; offset <= span; offset += 1) {
                    const distance = Math.abs(offset) / Math.max(0.35, radius);
                    const density = Math.max(0, 1 - distance * 0.9) * (1 - progress * 0.7);
                    if (Math.random() > density * 0.54) continue;

                    const localHeat = (1 - progress) * randomBetween(0.46, 0.82)
                        + (progress < 0.34 && Math.random() > 0.9 ? 0.18 : 0)
                        + windForce * 0.08;
                    const alpha = Math.max(0.025, density * fade * flame.heat * (1 + windForce * 0.18));
                    ctx.fillStyle = heatColor(localHeat, alpha);
                    ctx.fillText(randomLetter(), (center + offset) * fontSize, y);
                }
            }
        }
    }

    function spawnSpark() {
        const sparkLimit = 34 + Math.floor(windForce * 18);
        const sparkChance = 0.085 + windForce * 0.07;
        if (sparks.length > sparkLimit || Math.random() > sparkChance) return;
        sparks.push({
            x: Math.random() * width,
            y: height + randomBetween(0, 16),
            vx: randomBetween(-0.26, 0.26),
            vy: randomBetween(0.85, 3.2),
            life: randomBetween(0.28, 0.9),
            warm: Math.random() > 0.22,
            char: randomLetter(),
        });
    }

    function drawSparks() {
        for (let i = sparks.length - 1; i >= 0; i -= 1) {
            const spark = sparks[i];
            spark.life -= 0.009;
            spark.x += spark.vx + wind * 0.58;
            spark.y -= spark.vy;

            if (spark.life <= 0 || spark.y < -fontSize) {
                sparks.splice(i, 1);
                continue;
            }

            ctx.fillStyle = spark.warm
                ? `rgba(255, 204, 130, ${spark.life})`
                : `rgba(255, 82, 78, ${spark.life * 0.74})`;
            ctx.fillText(spark.char, spark.x, spark.y);
        }
    }

    function isFireThemeActive() {
        return document.documentElement.dataset.theme === 'fire';
    }

    function draw(now = 0) {
        if (document.hidden || !isFireThemeActive()) {
            lastDrawTime = now;
            animationId = requestAnimationFrame(draw);
            return;
        }

        if (now - lastDrawTime < frameInterval) {
            animationId = requestAnimationFrame(draw);
            return;
        }

        lastDrawTime = now - ((now - lastDrawTime) % frameInterval);
        frame += 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.145)';
        ctx.fillRect(0, 0, width, height);

        ctx.font = `${fontSize}px arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'source-over';

        updateWind();
        drawFireBed();
        const flameCount = flames.length;
        for (let i = 0; i < flameCount; i += 1) drawFlame(flames[i]);
        spawnSpark();
        drawSparks();

        animationId = requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    resize();
    animationId = requestAnimationFrame(draw);

    window.addEventListener('beforeunload', () => {
        if (animationId) cancelAnimationFrame(animationId);
    });
}());
