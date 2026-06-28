const CULT_TOKEN_ADDRESS = '0xf0f9d895aca5c8678f706fb8216fa22957685a13';
const DCULT_TOKEN_ADDRESS = '0x2d77b594b9bbaed03221f7c63af8c4307432daf1';
const CULT_CREATION_TX = '0x9b6bc8e16ea2575c54a0abdc96604f50cf4e75c9dd463bef9ce92cc04381d3c9';
const CULT_CREATION_BLOCK = 14093760;
const DEAD_WALLETS = Object.freeze([
    {
        label: 'Burn Wallet 1',
        address: '0x000000000000000000000000000000000000dEaD',
    },
    {
        label: 'Burn Wallet 2',
        address: '0xdEAD000000000000000042069420694206942069',
    },
]);

const ERC20_ABI = Object.freeze([
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
]);

const READ_RPCS = Object.freeze([
    { label: 'MevBlocker', url: 'https://rpc.mevblocker.io' },
    { label: 'Cloudflare', url: 'https://cloudflare-eth.com' },
    { label: 'PublicNode', url: 'https://ethereum.publicnode.com' },
    { label: '1RPC', url: 'https://1rpc.io/eth' },
    { label: 'dRPC', url: 'https://eth.drpc.org' },
]);

const LOG_RPCS = READ_RPCS;
const LOG_CHUNK_SIZE = 1_000_000;

const CACHE_VERSION = 3;
const CACHE_KEY = `cultBurnTracker:v${CACHE_VERSION}`;
const THEME_STORAGE_KEY = 'cultBurnTrackerTheme';
const THEME_SEQUENCE = Object.freeze(['fire', 'default', 'publish']);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const DEPOSIT_TOPIC = ethers.utils.id('Deposit(address,uint256,uint256)');
const FINALITY_BLOCKS = 8;
const LEADERBOARD_LIMIT = 10;
const RECENT_COLLAPSED_LIMIT = 1;

let providerInfo = null;
let readProvider = null;
let scanState = createEmptyScanState();
let latestSafeBlock = CULT_CREATION_BLOCK;
let scanInFlight = false;
let latestBurnsExpanded = false;

const el = {
    statusLine: document.getElementById('status-line'),
    totalBurned: document.getElementById('total-burned'),
    totalContributed: document.getElementById('total-contributed'),
    burnPercent: document.getElementById('burn-percent'),
    burnPercentBar: document.getElementById('burn-percent-bar'),
    totalSupply: document.getElementById('total-supply'),
    latestBlock: document.getElementById('latest-block'),
    burnWallets: document.getElementById('burn-wallets'),
    scanDetail: document.getElementById('scan-detail'),
    recentBurns: document.getElementById('recent-burns'),
    leaderboard: document.getElementById('leaderboard'),
    returnsLeaderboard: document.getElementById('returns-leaderboard'),
    refreshBtn: document.getElementById('refresh-btn'),
    resetCacheBtn: document.getElementById('reset-cache-btn'),
    shuffleTheme: document.getElementById('shuffle-theme-btn'),
    themeToggle: document.getElementById('theme-toggle'),
    latestToggle: document.getElementById('latest-toggle'),
    latestToggleLabel: document.getElementById('latest-toggle-label'),
    menuToggle: document.getElementById('menu-toggle'),
    utilityMenu: document.getElementById('utility-menu'),
};

document.addEventListener('DOMContentLoaded', () => {
    applySavedTheme();
    el.refreshBtn.addEventListener('click', () => initialize({ forceRefresh: true }));
    el.resetCacheBtn.addEventListener('click', () => {
        closeUtilityMenu();
        initialize({ rebuildIndex: true });
    });
    el.shuffleTheme.addEventListener('click', shuffleTheme);
    el.themeToggle.addEventListener('click', toggleTheme);
    el.latestToggle?.addEventListener('click', toggleLatestBurns);
    el.menuToggle.addEventListener('click', toggleUtilityMenu);
    document.addEventListener('click', closeUtilityMenuOnOutsideClick);
    document.addEventListener('keydown', closeUtilityMenuOnEscape);
    initialize();
});

async function initialize(options = {}) {
    if (scanInFlight) return;

    const { rebuildIndex = false, forceRefresh = false } = options;
    setBusy(true);
    setStatus('Connecting to public Ethereum RPC...');

    try {
        if (!readProvider || forceRefresh) {
            ({ provider: readProvider, info: providerInfo } = await getWorkingProvider());
        }

        const latestBlock = await readProvider.getBlockNumber();
        latestSafeBlock = Math.max(CULT_CREATION_BLOCK, latestBlock - FINALITY_BLOCKS);
        if (el.latestBlock) el.latestBlock.textContent = `Block ${formatInteger(latestBlock)}`;
        setStatus(`Live via ${providerInfo.label}. Public view, no wallet required.`);

        const chainData = await loadBurnBalances();
        renderSupply(chainData);

        scanState = rebuildIndex ? createEmptyScanState() : loadScanCache();
        if (rebuildIndex) saveScanCache(scanState);

        renderScanState(chainData.totalBurned);
        await scanBurnLogs(chainData.totalBurned);
    } catch (error) {
        console.error(error);
        setStatus(error?.message || 'Unable to load burn data.', true);
    } finally {
        setBusy(false);
    }
}

async function getWorkingProvider() {
    let lastError = null;

    for (const rpc of READ_RPCS) {
        try {
            const provider = new ethers.providers.StaticJsonRpcProvider(
                rpc.url,
                { chainId: 1, name: 'homestead' },
            );
            const blockNumber = await withTimeout(provider.getBlockNumber(), 8000, `${rpc.label} block number`);
            if (!Number.isFinite(blockNumber) || blockNumber <= 0) {
                throw new Error(`${rpc.label} returned an invalid block number`);
            }
            return { provider, info: rpc };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('No public Ethereum RPC responded.');
}

async function loadBurnBalances() {
    const cult = new ethers.Contract(CULT_TOKEN_ADDRESS, ERC20_ABI, readProvider);
    const [totalSupply, ...balances] = await Promise.all([
        cult.totalSupply(),
        ...DEAD_WALLETS.map((wallet) => cult.balanceOf(wallet.address)),
    ]);

    const totalBurned = balances.reduce((sum, balance) => sum.add(balance), ethers.BigNumber.from(0));
    const wallets = DEAD_WALLETS.map((wallet, index) => ({ ...wallet, balance: balances[index] }));

    return { totalSupply, totalBurned, wallets };
}

function renderSupply({ totalSupply, totalBurned, wallets }) {
    const percent = getPercent(totalBurned, totalSupply);

    el.totalBurned.textContent = `${formatTokenAmount(totalBurned, 0)} CULT`;
    el.totalSupply.textContent = `${formatTokenAmount(totalSupply, 0)} CULT`;
    el.burnPercent.textContent = `${formatPercentValue(percent.value, 2)}%`;
    el.burnPercentBar.style.width = `${Math.min(percent.value, 100)}%`;

    if (!el.burnWallets) return;
    el.burnWallets.innerHTML = wallets.map((wallet) => {
        const walletPercent = getPercent(wallet.balance, totalSupply);
        return `
            <article class="wallet-card">
                <h3>${escapeHtml(wallet.label)}</h3>
                <a class="address-link" href="${addressUrl(wallet.address)}" target="_blank" rel="noopener noreferrer">${shortAddress(wallet.address)}</a>
                <span class="value">${formatTokenAmount(wallet.balance, 0)} CULT</span>
                <div class="event-meta">${walletPercent.text}% of total supply</div>
            </article>
        `;
    }).join('');
}

async function scanBurnLogs(totalBurned) {
    scanInFlight = true;
    try {
        const startBlock = Math.max(CULT_CREATION_BLOCK, Number(scanState.scannedToBlock || CULT_CREATION_BLOCK - 1) + 1);

        if (startBlock > latestSafeBlock) {
            renderScanState(totalBurned);
            if (el.scanDetail) el.scanDetail.textContent = `Indexed through block ${formatInteger(scanState.scannedToBlock)}.`;
            return;
        }

        let fromBlock = startBlock;
        while (fromBlock <= latestSafeBlock) {
            const toBlock = Math.min(fromBlock + LOG_CHUNK_SIZE - 1, latestSafeBlock);
            setScanProgress(fromBlock - CULT_CREATION_BLOCK, latestSafeBlock - CULT_CREATION_BLOCK);
            if (el.scanDetail) el.scanDetail.textContent = `Scanning ${formatInteger(fromBlock)} to ${formatInteger(toBlock)} via public RPC...`;

            const [burnLogs, returnLogs, depositLogs] = await Promise.all([
                getBurnLogs(fromBlock, toBlock),
                getReturnLogs(fromBlock, toBlock),
                getDepositLogs(fromBlock, toBlock),
            ]);
            const depositMatches = createDepositMatchMap(depositLogs);
            for (const log of burnLogs) processBurnLog(log);
            for (const log of returnLogs) processReturnLog(log, depositMatches);

            scanState.scannedToBlock = toBlock;
            scanState.updatedAt = Date.now();
            saveScanCache(scanState);
            renderScanState(totalBurned);

            fromBlock = toBlock + 1;
            await sleep(50);
        }

        setScanProgress(1, 1);
        if (el.scanDetail) el.scanDetail.textContent = `Indexed through block ${formatInteger(scanState.scannedToBlock)}.`;
    } finally {
        scanInFlight = false;
    }
}

async function getBurnLogs(fromBlock, toBlock) {
    const toTopics = DEAD_WALLETS.map((wallet) => ethers.utils.hexZeroPad(wallet.address, 32).toLowerCase());
    const filter = {
        fromBlock: ethers.utils.hexValue(fromBlock),
        toBlock: ethers.utils.hexValue(toBlock),
        address: CULT_TOKEN_ADDRESS,
        topics: [TRANSFER_TOPIC, null, toTopics],
    };

    return getLogsWithSplit(filter);
}

async function getReturnLogs(fromBlock, toBlock) {
    const filter = {
        fromBlock: ethers.utils.hexValue(fromBlock),
        toBlock: ethers.utils.hexValue(toBlock),
        address: CULT_TOKEN_ADDRESS,
        topics: [TRANSFER_TOPIC, null, ethers.utils.hexZeroPad(DCULT_TOKEN_ADDRESS, 32).toLowerCase()],
    };

    return getLogsWithSplit(filter);
}

async function getDepositLogs(fromBlock, toBlock) {
    const poolZeroTopic = ethers.utils.hexZeroPad('0x0', 32).toLowerCase();
    const filter = {
        fromBlock: ethers.utils.hexValue(fromBlock),
        toBlock: ethers.utils.hexValue(toBlock),
        address: DCULT_TOKEN_ADDRESS,
        topics: [DEPOSIT_TOPIC, null, poolZeroTopic],
    };

    return getLogsWithSplit(filter);
}

function processBurnLog(log) {
    if (!log?.topics || log.topics.length < 3 || !log.data) return;

    const from = topicToAddress(log.topics[1]);
    const to = topicToAddress(log.topics[2]);
    const amount = ethers.BigNumber.from(log.data);
    const key = from.toLowerCase();
    const current = ethers.BigNumber.from(scanState.leaderboard[key] || '0');
    const blockNumber = Number.parseInt(String(log.blockNumber), 16);
    const transactionIndex = Number.parseInt(String(log.transactionIndex || '0x0'), 16);
    const logIndex = Number.parseInt(String(log.logIndex || '0x0'), 16);
    const timestamp = log.blockTimestamp ? Number.parseInt(String(log.blockTimestamp), 16) : null;

    scanState.leaderboard[key] = current.add(amount).toString();
    scanState.eventCount += 1;
    const event = {
        amount: amount.toString(),
        from,
        to,
        transactionHash: log.transactionHash,
        blockNumber,
        transactionIndex,
        logIndex,
        timestamp,
    };

    updateLatestEvent(scanState.latestBurnByAddress, key, event);
    scanState.recent.push(event);
    scanState.recent.sort(sortEventsDesc);
    scanState.recent = scanState.recent.slice(0, 10);
}

function createDepositMatchMap(logs) {
    return logs.reduce((matches, log) => {
        if (!log?.topics || log.topics.length < 3 || !log.data || !log.transactionHash) return matches;

        const user = topicToAddress(log.topics[1]).toLowerCase();
        const amount = ethers.BigNumber.from(log.data).toString();
        const key = createTransferMatchKey(log.transactionHash, user, amount);
        matches.set(key, (matches.get(key) || 0) + 1);
        return matches;
    }, new Map());
}

function processReturnLog(log, depositMatches) {
    if (!log?.topics || log.topics.length < 3 || !log.data) return;

    const from = topicToAddress(log.topics[1]);
    const to = topicToAddress(log.topics[2]);
    const amount = ethers.BigNumber.from(log.data);
    const matchKey = createTransferMatchKey(log.transactionHash, from.toLowerCase(), amount.toString());
    const depositCount = depositMatches.get(matchKey) || 0;
    if (depositCount > 0) {
        depositMatches.set(matchKey, depositCount - 1);
        return;
    }

    const key = from.toLowerCase();
    const current = ethers.BigNumber.from(scanState.returnLeaderboard[key] || '0');
    scanState.returnLeaderboard[key] = current.add(amount).toString();
    updateLatestEvent(scanState.latestReturnByAddress, key, {
        amount: amount.toString(),
        from,
        to,
        transactionHash: log.transactionHash,
        blockNumber: Number.parseInt(String(log.blockNumber), 16),
        transactionIndex: Number.parseInt(String(log.transactionIndex || '0x0'), 16),
        logIndex: Number.parseInt(String(log.logIndex || '0x0'), 16),
        timestamp: log.blockTimestamp ? Number.parseInt(String(log.blockTimestamp), 16) : null,
    });
}

function renderScanState(totalBurned) {
    renderContributedTotal();
    renderRecent();
    renderLeaderboard(totalBurned);
    renderReturnLeaderboard();
    setScanProgress(
        Math.max(0, Number(scanState.scannedToBlock || CULT_CREATION_BLOCK) - CULT_CREATION_BLOCK),
        Math.max(1, latestSafeBlock - CULT_CREATION_BLOCK),
    );
}

function renderRecent() {
    if (!scanState.recent.length) {
        el.recentBurns.innerHTML = '<p class="empty-state">No indexed burns yet.</p>';
        updateLatestToggle();
        return;
    }

    const visibleLimit = latestBurnsExpanded ? 10 : RECENT_COLLAPSED_LIMIT;
    el.recentBurns.innerHTML = scanState.recent.slice(0, visibleLimit).map((event) => {
        const dateLabel = event.timestamp ? formatDate(event.timestamp) : `Block ${formatInteger(event.blockNumber)}`;

        return `
            <article class="event-row">
                <div class="event-amount">${formatTokenAmount(event.amount, 0)} CULT</div>
                <div class="event-meta event-date">${dateLabel}</div>
                <div class="event-meta event-from">
                    From <a href="${addressUrl(event.from)}" target="_blank" rel="noopener noreferrer">${shortAddress(event.from)}</a>
                </div>
                <div class="event-meta event-tx-cell">
                    <a class="tx-icon-link" href="${txUrl(event.transactionHash)}" target="_blank" rel="noopener noreferrer" title="View transaction on Etherscan" aria-label="View transaction on Etherscan">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
                            <path d="M224,104a8,8,0,0,1-16,0V59.31l-82.34,82.35a8,8,0,0,1-11.32-11.32L196.69,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"/>
                        </svg>
                    </a>
                </div>
            </article>
        `;
    }).join('');
    updateLatestToggle();
}

function renderReturnLeaderboard() {
    if (!el.returnsLeaderboard) return;

    const entries = Object.entries(scanState.returnLeaderboard)
        .map(([address, amount]) => ({ address, amount: ethers.BigNumber.from(amount) }))
        .sort((a, b) => compareBigNumbersDesc(a.amount, b.amount))
        .slice(0, LEADERBOARD_LIMIT);

    if (!entries.length) {
        el.returnsLeaderboard.innerHTML = '<p class="empty-state">No indexed return contributors yet.</p>';
        return;
    }

    const totalReturns = Object.values(scanState.returnLeaderboard)
        .reduce((sum, amount) => sum.add(ethers.BigNumber.from(amount)), ethers.BigNumber.from(0));

    el.returnsLeaderboard.innerHTML = entries.map((entry, index) => {
        const share = getPercent(entry.amount, totalReturns);
        const latestEvent = scanState.latestReturnByAddress[entry.address.toLowerCase()];
        return `
            <article class="leaderboard-row">
                <span class="rank">${index + 1}</span>
                <div>
                    <div class="leaderboard-amount">${formatTokenAmount(entry.amount, 0)} CULT</div>
                    <div class="leaderboard-meta">
                        <a href="${addressUrl(entry.address)}" target="_blank" rel="noopener noreferrer">${shortAddress(entry.address)}</a>
                        · ${formatPercentValue(share.value, 2)}% of returned CULT
                    </div>
                </div>
                ${renderTxIconLink(latestEvent, 'View latest contribution transaction on Etherscan')}
            </article>
        `;
    }).join('');
}

function renderContributedTotal() {
    if (!el.totalContributed) return;
    el.totalContributed.textContent = `${formatTokenAmount(getTotalReturnContributions(), 0)} CULT`;
}

function getTotalReturnContributions() {
    return Object.values(scanState.returnLeaderboard)
        .reduce((sum, amount) => sum.add(ethers.BigNumber.from(amount)), ethers.BigNumber.from(0));
}

function updateLatestEvent(latestByAddress, addressKey, event) {
    if (!latestByAddress || !addressKey || !event?.transactionHash) return;

    const current = latestByAddress[addressKey];
    if (!current || sortEventsDesc(event, current) < 0) {
        latestByAddress[addressKey] = event;
    }
}

function renderTxIconLink(event, label) {
    if (!event?.transactionHash) {
        return '<span class="tx-icon-link tx-icon-link-placeholder" aria-hidden="true"></span>';
    }

    return `
        <a class="tx-icon-link" href="${txUrl(event.transactionHash)}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="${label}">
            ${renderExternalLinkIcon()}
        </a>
    `;
}

function renderExternalLinkIcon() {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
            <path d="M224,104a8,8,0,0,1-16,0V59.31l-82.34,82.35a8,8,0,0,1-11.32-11.32L196.69,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"/>
        </svg>
    `;
}

function toggleLatestBurns() {
    latestBurnsExpanded = !latestBurnsExpanded;
    renderRecent();
}

function updateLatestToggle() {
    if (!el.latestToggle || !el.latestToggleLabel) return;
    const canExpand = scanState.recent.length > RECENT_COLLAPSED_LIMIT;
    el.latestToggle.disabled = !canExpand;
    el.latestToggle.setAttribute('aria-expanded', String(latestBurnsExpanded && canExpand));
    el.latestToggleLabel.textContent = latestBurnsExpanded && canExpand ? 'Show latest' : 'Show all 10';
}

function renderLeaderboard(totalBurned) {
    const entries = Object.entries(scanState.leaderboard)
        .map(([address, amount]) => ({ address, amount: ethers.BigNumber.from(amount) }))
        .sort((a, b) => compareBigNumbersDesc(a.amount, b.amount))
        .slice(0, LEADERBOARD_LIMIT);

    if (!entries.length) {
        el.leaderboard.innerHTML = '<p class="empty-state">No indexed burners yet.</p>';
        return;
    }

    el.leaderboard.innerHTML = entries.map((entry, index) => {
        const share = getPercent(entry.amount, totalBurned);
        const latestEvent = scanState.latestBurnByAddress[entry.address.toLowerCase()];
        return `
            <article class="leaderboard-row">
                <span class="rank">${index + 1}</span>
                <div>
                    <div class="leaderboard-amount">${formatTokenAmount(entry.amount, 0)} CULT</div>
                    <div class="leaderboard-meta">
                        <a href="${addressUrl(entry.address)}" target="_blank" rel="noopener noreferrer">${shortAddress(entry.address)}</a>
                        · ${formatPercentValue(share.value, 2)}% of burned CULT
                    </div>
                </div>
                ${renderTxIconLink(latestEvent, 'View latest burn transaction on Etherscan')}
            </article>
        `;
    }).join('');
}

async function rpcFetch(url, method, params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18_000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
            signal: controller.signal,
        });

        if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.error) throw new Error(payload.error.message || `${method} failed`);
        return payload.result;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function getLogsWithSplit(filter) {
    let lastError = null;
    let rangeError = null;

    for (const rpc of LOG_RPCS) {
        try {
            return await rpcFetch(rpc.url, 'eth_getLogs', [filter]);
        } catch (error) {
            lastError = error;
            if (isRangeLimitError(error)) rangeError = error;
        }
    }

    try {
        if (!rangeError) throw lastError;
        const fromBlock = Number.parseInt(String(filter.fromBlock), 16);
        const toBlock = Number.parseInt(String(filter.toBlock), 16);
        if (fromBlock >= toBlock) throw rangeError;

        const midpoint = Math.floor((fromBlock + toBlock) / 2);
        const [left, right] = await Promise.all([
            getLogsWithSplit({
                ...filter,
                fromBlock: ethers.utils.hexValue(fromBlock),
                toBlock: ethers.utils.hexValue(midpoint),
            }),
            getLogsWithSplit({
                ...filter,
                fromBlock: ethers.utils.hexValue(midpoint + 1),
                toBlock: ethers.utils.hexValue(toBlock),
            }),
        ]);
        return left.concat(right);
    } catch (error) {
        throw error || lastError || new Error('Unable to fetch event logs.');
    }
}

function isRangeLimitError(error) {
    return /more than 10000|query returned more than|response size exceeded|too many results|block range|limit exceeded|exceed/i.test(error?.message || '');
}

function createEmptyScanState() {
    return {
        version: CACHE_VERSION,
        creationTx: CULT_CREATION_TX,
        scannedToBlock: CULT_CREATION_BLOCK - 1,
        eventCount: 0,
        leaderboard: {},
        returnLeaderboard: {},
        latestBurnByAddress: {},
        latestReturnByAddress: {},
        recent: [],
        updatedAt: null,
    };
}

function loadScanCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (!cached || cached.version !== CACHE_VERSION || cached.creationTx !== CULT_CREATION_TX) {
            return createEmptyScanState();
        }
        return {
            ...createEmptyScanState(),
            ...cached,
            leaderboard: cached.leaderboard && typeof cached.leaderboard === 'object' ? cached.leaderboard : {},
            returnLeaderboard: cached.returnLeaderboard && typeof cached.returnLeaderboard === 'object' ? cached.returnLeaderboard : {},
            latestBurnByAddress: cached.latestBurnByAddress && typeof cached.latestBurnByAddress === 'object' ? cached.latestBurnByAddress : {},
            latestReturnByAddress: cached.latestReturnByAddress && typeof cached.latestReturnByAddress === 'object' ? cached.latestReturnByAddress : {},
            recent: Array.isArray(cached.recent) ? cached.recent.slice(0, 10) : [],
        };
    } catch {
        return createEmptyScanState();
    }
}

function saveScanCache(state) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch (error) {
        console.warn('Unable to persist burn index cache:', error);
    }
}

function applySavedTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (!savedTheme) {
        applyTheme('fire');
        return;
    }

    try {
        const parsed = JSON.parse(savedTheme);
        if (parsed?.type === 'random' && parsed.colors) {
            applyRandomTheme(parsed.colors);
            return;
        }
        if (parsed?.type === 'standard') {
            applyTheme(parsed.name);
            return;
        }
    } catch {
        applyTheme(savedTheme);
        return;
    }

    applyTheme('fire');
}

function toggleTheme() {
    const current = document.documentElement.dataset.theme || 'fire';
    const currentIndex = THEME_SEQUENCE.indexOf(current);
    const next = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length] || 'fire';
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ type: 'standard', name: next }));
}

function shuffleTheme() {
    const colors = {
        color1: getRandomColor(),
        color2: getRandomColor(),
        btnColor: getRandomColor(),
    };
    applyRandomTheme(colors);
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ type: 'random', colors }));
}

function applyTheme(themeName) {
    const root = document.documentElement;
    if (themeName === 'fire') {
        root.style.setProperty('--background-image', 'radial-gradient(circle, #050505, black)');
        root.style.setProperty('--btn-bg', '#333333');
        root.style.setProperty('--wallet-dropdown-bg', '#050505');
        root.style.setProperty('--ui-section-blur', 'blur(0px)');
        root.dataset.theme = 'fire';
        return;
    }

    if (themeName === 'publish') {
        root.style.setProperty('--background-image', 'radial-gradient(circle, #ff5252, black)');
        root.style.setProperty('--btn-bg', '#333333');
        root.style.setProperty('--wallet-dropdown-bg', '#050505');
        root.style.setProperty('--ui-section-blur', 'blur(0px)');
        root.dataset.theme = 'publish';
        return;
    }

    root.style.setProperty('--background-image', 'radial-gradient(circle, #222222, black)');
    root.style.setProperty('--btn-bg', '#ff5252');
    root.style.setProperty('--wallet-dropdown-bg', '#ff5252');
    root.style.setProperty('--ui-section-blur', 'blur(0px)');
    root.dataset.theme = 'default';
}

function applyRandomTheme(colors) {
    const root = document.documentElement;
    root.style.setProperty('--background-image', `radial-gradient(circle, ${colors.color1}, ${colors.color2})`);
    root.style.setProperty('--btn-bg', colors.btnColor);
    root.style.setProperty('--wallet-dropdown-bg', 'var(--color-details)');
    root.style.setProperty('--ui-section-blur', 'blur(0px)');
    root.dataset.theme = 'random';
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i += 1) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function setBusy(isBusy) {
    el.refreshBtn.disabled = isBusy;
    el.resetCacheBtn.disabled = isBusy;
}

function toggleUtilityMenu(event) {
    event.stopPropagation();
    const isOpen = el.utilityMenu.classList.toggle('show');
    el.menuToggle.setAttribute('aria-expanded', String(isOpen));
}

function closeUtilityMenu() {
    el.utilityMenu.classList.remove('show');
    el.menuToggle.setAttribute('aria-expanded', 'false');
}

function closeUtilityMenuOnOutsideClick(event) {
    if (!el.utilityMenu.classList.contains('show')) return;
    if (event.target.closest('.menu-widget')) return;
    closeUtilityMenu();
}

function closeUtilityMenuOnEscape(event) {
    if (event.key === 'Escape') closeUtilityMenu();
}

function setStatus(message, danger = false) {
    if (!el.statusLine) return;
    el.statusLine.textContent = message;
    el.statusLine.classList.toggle('danger-text', danger);
}

function setScanProgress(done, total) {
    if (!el.scanProgressFill) return;
    const percent = total <= 0 ? 0 : Math.max(0, Math.min(100, (done / total) * 100));
    el.scanProgressFill.style.width = `${percent}%`;
}

function getPercent(part, total) {
    const bnPart = ethers.BigNumber.from(part || 0);
    const bnTotal = ethers.BigNumber.from(total || 0);
    if (bnTotal.isZero()) return { text: '0.0000', value: 0 };

    const scaled = bnPart.mul(1_000_000).div(bnTotal);
    const value = Number(scaled.toString()) / 10_000;
    return {
        text: value.toLocaleString('en-US', {
            minimumFractionDigits: 4,
            maximumFractionDigits: 4,
        }),
        value,
    };
}

function formatPercentValue(value, fractionDigits) {
    return Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
}

function formatTokenAmount(value, fractionDigits = 0) {
    const raw = ethers.utils.formatUnits(value, 18);
    const [wholePart, fractionalPart = ''] = raw.split('.');
    const groupedWhole = formatIntegerString(wholePart);

    if (fractionDigits <= 0) return groupedWhole;

    const fractional = fractionalPart.padEnd(fractionDigits, '0').slice(0, fractionDigits);
    return `${groupedWhole}.${fractional}`;
}

function formatInteger(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatIntegerString(value) {
    return String(value || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(timestamp * 1000));
}

function shortAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortHash(hash) {
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function topicToAddress(topic) {
    return ethers.utils.getAddress(`0x${String(topic).slice(-40)}`);
}

function createTransferMatchKey(txHash, from, amount) {
    return `${String(txHash).toLowerCase()}:${String(from).toLowerCase()}:${amount}`;
}

function addressUrl(address) {
    return `https://etherscan.io/address/${address}`;
}

function txUrl(txHash) {
    return `https://etherscan.io/tx/${txHash}`;
}

function sortEventsDesc(a, b) {
    return (b.blockNumber - a.blockNumber)
        || ((b.transactionIndex || 0) - (a.transactionIndex || 0))
        || ((b.logIndex || 0) - (a.logIndex || 0));
}

function compareBigNumbersDesc(a, b) {
    if (a.eq(b)) return 0;
    return a.gt(b) ? -1 : 1;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function withTimeout(promise, ms, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    });

    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timeoutId)),
        timeout,
    ]);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
