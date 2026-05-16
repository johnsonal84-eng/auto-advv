// ─────────────────────────────────────────────────────────────────────────────
// SAB AutoAdv Bot — single file
// Setup:
//   1. npm install discord.js dotenv
//   2. Create .env with DISCORD_TOKEN and CLIENT_ID
//   3. node index.js --deploy   (first run, registers slash commands)
//   4. node index.js            (normal start)
// ─────────────────────────────────────────────────────────────────────────────

// ── Config — paste your values here ──────────────────────────────────────────
const DISCORD_TOKEN = 'your_bot_token_here';
const CLIENT_ID     = 'your_client_id_here';
// ─────────────────────────────────────────────────────────────────────────────

const {
  Client, GatewayIntentBits, Collection, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════════
// DATABASE  (JSON file)
// ══════════════════════════════════════════════════════════════════════════════

const DB_PATH = path.join(__dirname, 'data.json');

function dbLoad() {
  if (!fs.existsSync(DB_PATH))
    fs.writeFileSync(DB_PATH, JSON.stringify({ licenses: {}, sessions: {} }, null, 2));
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function dbSave(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function claimLicense(userId, key) {
  const db = dbLoad();
  for (const [uid, info] of Object.entries(db.licenses))
    if (info.key === key && uid !== userId) return { ok: false, reason: 'key_taken' };
  if (db.licenses[userId] && db.licenses[userId].key !== key)
    return { ok: false, reason: 'already_claimed' };
  db.licenses[userId] = { key, claimedAt: Date.now() };
  dbSave(db);
  return { ok: true };
}
function getLicense(userId) { return dbLoad().licenses[userId] || null; }

function getSession(userId) { return dbLoad().sessions[userId] || null; }
function setSession(userId, data) {
  const db = dbLoad();
  db.sessions[userId] = { ...data, updatedAt: Date.now() };
  dbSave(db);
}
function deleteSession(userId) {
  const db = dbLoad();
  delete db.sessions[userId];
  dbSave(db);
}

// ══════════════════════════════════════════════════════════════════════════════
// ENGINE  (auto-adv runner — plug your real logic into the setInterval below)
// ══════════════════════════════════════════════════════════════════════════════

const activeJobs = new Map();

function startAutoAdv(userId, config) {
  if (activeJobs.has(userId)) return { ok: false, reason: 'already_running' };

  const job = {
    config,
    startedAt: Date.now(),
    ticks: 0,
    interval: setInterval(() => {
      const j = activeJobs.get(userId);
      if (j) j.ticks++;
      // ── TODO: trigger your actual auto-adv / message-posting logic here ──
    }, (config.delay || 60) * 1000),
  };

  activeJobs.set(userId, job);
  setSession(userId, { status: 'running', config, startedAt: Date.now() });
  return { ok: true };
}

function stopAutoAdv(userId) {
  const job = activeJobs.get(userId);
  if (!job) return { ok: false, reason: 'not_running' };
  clearInterval(job.interval);
  activeJobs.delete(userId);
  deleteSession(userId);
  return { ok: true };
}

function getStatus(userId) {
  const job = activeJobs.get(userId);
  if (!job) return null;
  return {
    running: true,
    config: job.config,
    startedAt: job.startedAt,
    elapsed: Math.floor((Date.now() - job.startedAt) / 1000),
    ticks: job.ticks,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function errorEmbed(msg) {
  return new EmbedBuilder().setColor(0xEF4444).setTitle('❌ Error').setDescription(msg);
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

// ── /claim ────────────────────────────────────────────────────────────────────
const claimCommand = {
  data: new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim your SAB AutoAdv license key')
    .addStringOption(o =>
      o.setName('key').setDescription('Your license key').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const key    = interaction.options.getString('key').trim();
    const userId = interaction.user.id;

    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key))
      return interaction.editReply({ embeds: [errorEmbed('Invalid key format. Expected: XXXX-XXXX-XXXX-XXXX')] });

    const existing = getLicense(userId);
    if (existing)
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xF59E0B).setTitle('⚠️ Already Claimed')
          .setDescription(`You already have license key: \`${existing.key}\`\nContact support to replace it.`)]
      });

    const result = claimLicense(userId, key);
    if (!result.ok)
      return interaction.editReply({ embeds: [errorEmbed(
        result.reason === 'key_taken'
          ? 'This license key is already in use by another user.'
          : 'You already have a license key linked to your account.'
      )] });

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x10B981).setTitle('✅ License Claimed!')
        .setDescription(`Your key \`${key}\` has been activated.`)
        .addFields({ name: 'Next Step', value: 'Use `/panel` to configure and start your auto-adv.' })
        .setFooter({ text: 'SAB AutoAdv Bot' }).setTimestamp()]
    });
  }
};

// ── /panel ────────────────────────────────────────────────────────────────────
async function sendPanel(interaction, userId, license, isUpdate) {
  const status  = getStatus(userId);
  const session = getSession(userId);
  const running = !!status;

  const embed = new EmbedBuilder()
    .setColor(running ? 0x10B981 : 0x6366F1)
    .setTitle('🎮 SAB AutoAdv Control Panel')
    .addFields(
      { name: '🔑 License', value: `\`${license.key}\``, inline: true },
      { name: '📡 Status',  value: running ? '🟢 Running' : '🔴 Stopped', inline: true },
    );

  if (running && status) {
    const mins = Math.floor(status.elapsed / 60);
    const secs = status.elapsed % 60;
    embed.addFields(
      { name: '⚙️ Brainrot', value: status.config.brainrot || 'Any',  inline: true },
      { name: '🌐 Channel',  value: `<#${status.config.channelId}>` || 'Not set', inline: true },
      { name: '⏱️ Uptime',   value: `${mins}m ${secs}s`,               inline: true },
      { name: '🔁 Ticks',    value: `${status.ticks}`,                  inline: true },
    );
  } else if (session?.config) {
    embed.addFields({ name: '⚙️ Last Config',
      value: `Brainrot: **${session.config.brainrot || 'Any'}** | Delay: **${session.config.delay}m**`, inline: false });
  }

  embed.setFooter({ text: 'SAB AutoAdv Bot' }).setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('panel_setup').setLabel('⚙️ Setup').setStyle(ButtonStyle.Secondary).setDisabled(running),
    new ButtonBuilder().setCustomId('panel_start').setLabel('▶️ Start').setStyle(ButtonStyle.Success).setDisabled(running),
    new ButtonBuilder().setCustomId('panel_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger).setDisabled(!running),
    new ButtonBuilder().setCustomId('panel_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Primary),
  );

  const payload = { embeds: [embed], components: [row], ephemeral: true };
  isUpdate ? await interaction.update(payload) : await interaction.reply(payload);
}

const panelCommand = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open your SAB AutoAdv control panel'),

  async execute(interaction) {
    const license = getLicense(interaction.user.id);
    if (!license)
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xEF4444).setTitle('❌ No License')
          .setDescription('Use `/claim <key>` to get started.')],
        ephemeral: true,
      });
    await sendPanel(interaction, interaction.user.id, license, false);
  }
};

// ── /status ───────────────────────────────────────────────────────────────────
const statusCommand = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check if your SAB AutoAdv is running'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const userId  = interaction.user.id;
    const license = getLicense(userId);

    if (!license)
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xEF4444)
        .setTitle('❌ No License').setDescription('Use `/claim <key>` to activate your license.')] });

    const status = getStatus(userId);
    if (!status)
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x6B7280)
        .setTitle('🔴 AutoAdv Not Running')
        .setDescription('Your auto-adv is currently stopped. Open `/panel` to start it.')
        .addFields({ name: '🔑 License', value: `\`${license.key}\``, inline: true })
        .setTimestamp()] });

    const mins      = Math.floor(status.elapsed / 60);
    const secs      = status.elapsed % 60;
    const startedAt = Math.floor(status.startedAt / 1000);

    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x10B981)
      .setTitle('🟢 AutoAdv Running')
      .addFields(
        { name: '🔑 License',  value: `\`${license.key}\``,         inline: true },
        { name: '⚙️ Brainrot', value: status.config.brainrot || 'Any', inline: true },
        { name: '🌐 Channel',  value: status.config.channelId ? `<#${status.config.channelId}>` : 'Not set', inline: true },
        { name: '⏱️ Uptime',   value: `${mins}m ${secs}s`,          inline: true },
        { name: '🔁 Ticks',    value: `${status.ticks}`,             inline: true },
        { name: '🕐 Started',  value: `<t:${startedAt}:R>`,          inline: true },
      )
      .setFooter({ text: 'Use /stop to stop your auto-adv' }).setTimestamp()] });
  }
};

// ── /stop ─────────────────────────────────────────────────────────────────────
const stopCommand = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop your SAB AutoAdv'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const userId  = interaction.user.id;
    const license = getLicense(userId);

    if (!license)
      return interaction.editReply({ embeds: [errorEmbed('Use `/claim <key>` to activate your license first.')] });

    const before = getStatus(userId);
    if (!before)
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xF59E0B)
        .setTitle('⚠️ Not Running').setDescription('Your auto-adv is already stopped.')] });

    const mins = Math.floor(before.elapsed / 60);
    const secs = before.elapsed % 60;
    stopAutoAdv(userId);

    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xEF4444)
      .setTitle('⏹️ AutoAdv Stopped')
      .setDescription('Your auto-adv has been stopped successfully.')
      .addFields(
        { name: '⏱️ Total Uptime', value: `${mins}m ${secs}s`,           inline: true },
        { name: '🔁 Total Ticks',  value: `${before.ticks}`,              inline: true },
        { name: '⚙️ Brainrot',     value: before.config.brainrot || 'Any', inline: true },
      )
      .setFooter({ text: 'Use /panel to restart' }).setTimestamp()] });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// BUTTON & MODAL HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

async function handlePanelButton(interaction) {
  const userId  = interaction.user.id;
  const license = getLicense(userId);
  if (!license) return interaction.reply({ content: '❌ No license found.', ephemeral: true });

  const id = interaction.customId;

  if (id === 'panel_refresh') return sendPanel(interaction, userId, license, true);

  if (id === 'panel_setup') {
    const modal = new ModalBuilder().setCustomId('panel_setup_modal').setTitle('AutoAdv Setup');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('setup_brainrot').setLabel('Target Brainrot (blank = any)')
          .setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g. Noobini Pizzanini')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('setup_channel').setLabel('Channel ID to post ads in')
          .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 1504643954967056564')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('setup_message').setLabel('Your ad message')
          .setStyle(TextInputStyle.Paragraph).setRequired(true)
          .setPlaceholder('**Looking for:**\n- Strawberry Elephant\n- Dragon Cannelloni')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('setup_delay').setLabel('Interval in minutes (default: 1)')
          .setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('1')
      ),
    );
    return interaction.showModal(modal);
  }

  if (id === 'panel_start') {
    const session = getSession(userId);
    const config  = session?.config;
    if (!config?.channelId)
      return interaction.reply({ content: '⚙️ Run Setup first to set your channel and ad message.', ephemeral: true });
    const result = startAutoAdv(userId, config);
    if (!result.ok)
      return interaction.reply({ content: '⚠️ AutoAdv is already running.', ephemeral: true });
    return sendPanel(interaction, userId, license, true);
  }

  if (id === 'panel_stop') {
    stopAutoAdv(userId);
    return sendPanel(interaction, userId, license, true);
  }
}

async function handleSetupModal(interaction) {
  const userId    = interaction.user.id;
  const brainrot  = interaction.fields.getTextInputValue('setup_brainrot') || 'Any';
  const channelId = interaction.fields.getTextInputValue('setup_channel').trim();
  const message   = interaction.fields.getTextInputValue('setup_message').trim();
  const delay     = Math.max(1, parseInt(interaction.fields.getTextInputValue('setup_delay')) || 1);

  setSession(userId, { config: { brainrot, channelId, message, delay } });

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(0x6366F1).setTitle('✅ Setup Saved')
      .addFields(
        { name: 'Brainrot', value: brainrot,           inline: true },
        { name: 'Channel',  value: `<#${channelId}>`,  inline: true },
        { name: 'Interval', value: `${delay} min`,     inline: true },
        { name: 'Message',  value: message.slice(0, 200) + (message.length > 200 ? '…' : '') },
      )
      .setDescription('Hit **▶️ Start** in `/panel` to begin.')],
    ephemeral: true,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-POST  (sends the ad message to the configured channel on each tick)
// ══════════════════════════════════════════════════════════════════════════════

// This is called from startAutoAdv — we override the engine to post real messages.
// We need a reference to the client, so we wire it up after client is created.
let _client = null;

function startAutoAdvWithPosting(userId, config) {
  if (activeJobs.has(userId)) return { ok: false, reason: 'already_running' };

  const job = {
    config,
    startedAt: Date.now(),
    ticks: 0,
    interval: setInterval(async () => {
      const j = activeJobs.get(userId);
      if (!j) return;
      j.ticks++;

      // ── Post the ad message to the configured channel ──────────────────────
      try {
        const channel = await _client.channels.fetch(config.channelId);
        if (channel?.isTextBased()) await channel.send(config.message);
      } catch (err) {
        console.error(`[AutoAdv] Failed to post for ${userId}:`, err.message);
      }
      // ───────────────────────────────────────────────────────────────────────
    }, config.delay * 60 * 1000),
  };

  activeJobs.set(userId, job);
  setSession(userId, { status: 'running', config, startedAt: Date.now() });
  return { ok: true };
}

// Patch startAutoAdv to use the posting version
function startAutoAdv(userId, config) {
  return startAutoAdvWithPosting(userId, config);
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENT & SLASH COMMAND REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

const commands = [claimCommand, panelCommand, statusCommand, stopCommand];
const commandMap = new Collection();
for (const cmd of commands) commandMap.set(cmd.data.name, cmd);

async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map(c => c.data.toJSON()),
  });
  console.log('✅ Slash commands registered globally.');
}

async function main() {
  if (process.argv.includes('--deploy')) {
    await deployCommands();
    process.exit(0);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  _client = client;

  client.once('ready', () => console.log(`✅ SAB AutoAdv Bot online as ${client.user.tag}`));

  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isChatInputCommand()) {
        const cmd = commandMap.get(interaction.commandName);
        if (cmd) await cmd.execute(interaction);
        return;
      }
      if (interaction.isButton() && interaction.customId.startsWith('panel_')) {
        await handlePanelButton(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId === 'panel_setup_modal') {
        await handleSetupModal(interaction);
        return;
      }
    } catch (err) {
      console.error(err);
      const reply = { content: '❌ An error occurred.', ephemeral: true };
      try {
        interaction.replied || interaction.deferred
          ? await interaction.followUp(reply)
          : await interaction.reply(reply);
      } catch {}
    }
  });

  await client.login(DISCORD_TOKEN);
}

main();
