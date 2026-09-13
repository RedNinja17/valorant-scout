const TIER_BASE = 'https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04';

function rank(tier, tierName, rr) {
    return { tier, tierName, icon: `${TIER_BASE}/${tier}/smallicon.png`, rr };
}

function profileUrl(name, tag) {
    return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}%23${encodeURIComponent(tag)}/overview`;
}

const AGENTS = {
    jett: 'add6443a-41bd-e414-f6ad-e58d267f4e95',
    sage: '569fdd95-4d10-43ab-ca70-79becc718b46',
    omen: '8e253930-4c05-31dd-1b6c-968525494517',
    sova: '320b2a48-4d9b-a075-30f1-1f93a9b638fa',
    killjoy: '1e58de9c-4950-5125-93e9-a0aee9f98746',
    reyna: 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc',
    phoenix: 'eb93336a-449b-9c1b-0a54-a891f7921d69',
    raze: 'f94c3b30-42be-e959-889c-5aa313dba261',
    breach: '5f8d3a7f-467b-97f3-062c-13acf203c006',
    cypher: '117ed9e3-49f3-6512-3ccf-0cada7e3823b'
};

const ALLIES = [
    { name: 'Testaccount', tag: 'NA1', isSelf: true, agentId: AGENTS.jett, accountLevel: 214, rank: rank(21, 'Ascendant 1', 42) },
    { name: 'Fixture', tag: 'dev', agentId: AGENTS.sage, accountLevel: 88, rank: rank(20, 'Diamond 3', 71) },
    { name: 'Placeholder', tag: '0001', agentId: AGENTS.omen, accountLevel: 401, rank: rank(22, 'Ascendant 2', 15) },
    { name: 'SampleUser', tag: 'EU', agentId: AGENTS.sova, accountLevel: null, rank: rank(20, 'Diamond 3', 33) },
    { name: 'AVeryLongDisplayName', tag: 'LONG', agentId: AGENTS.killjoy, accountLevel: 9, rank: rank(11, 'Silver 3', 8) },
];

const ENEMIES = [
    { name: 'Dummy', tag: 'NA2', agentId: AGENTS.reyna, accountLevel: 133, rank: rank(24, 'Immortal 1', 88) },
    { name: 'Stub', tag: 'jp', agentId: AGENTS.phoenix, accountLevel: 62, rank: rank(21, 'Ascendant 1', 5) },
    { name: 'Q', tag: 'x', agentId: AGENTS.raze, accountLevel: 720, rank: rank(17, 'Platinum 3', 60) },
    { name: null, tag: null, agentId: AGENTS.breach, accountLevel: null, rank: null },
    { name: 'Example', tag: 'NA1', agentId: AGENTS.cypher, accountLevel: 190, rank: rank(11, 'Silver 3', 49) }
];

function build(seed, isMyTeam, index) {
    return {
        name: seed.name,
        tag: seed.tag,
        team: isMyTeam ? 'Blue' : 'Red',
        isMyTeam: isMyTeam,
        isSelf: seed.isSelf === true,
        puuid: `mock-${isMyTeam ? 'blue' : 'red'}-${index}`,
        agentId: seed.agentId ?? null,
        accountLevel: seed.accountLevel ?? null,
        incognito: false,
        rank: seed.rank ?? null,
        url: seed.name ? profileUrl(seed.name, seed.tag) : null
    };
}

function mockPayload(mode) {
    const allies = ALLIES.map((s, i) => build(s, true, i));
    const enemies = mode === 'pregame' ? [] : ENEMIES.map((s, i) => build(s, false, i));

    return {
        matchId: mode === 'pregame' ? 'mock-pregame' : 'mock-ingame',
        mapName: mode === 'pregame' ? 'Ascent' : 'Ascent',
        timestamp: Date.now(),
        players: [...allies, ...enemies]
    };
}

module.exports = { mockPayload };