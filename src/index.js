import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from './configStore.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure warrant workflow channels and post the warrant request embed.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('judge_channel')
        .setDescription('Channel where judges can accept/deny warrants')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((option) =>
      option
        .setName('embed_channel')
        .setDescription('Channel that receives the warrant request embed/button')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((option) =>
      option
        .setName('active_channel')
        .setDescription('Channel where approved warrants are posted')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
console.log('Registered slash commands.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const pendingDrafts = new Map();
const pendingJudged = new Map();

function postRequestEmbed(guildConfig, guildName) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Warrant Request Form')
    .setDescription(
      `Use the button below to start a warrant request for **${guildName}**.\n\nYou will be asked for warrant type, suspect details, probable cause, and an image upload.`,
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('warrant:start')
      .setLabel('Create Warrant Request')
      .setStyle(ButtonStyle.Primary),
  );

  return guildConfig.embedChannel.send({ embeds: [embed], components: [row] });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: 'This command can only be used in a guild.', ephemeral: true });
        return;
      }

      const judgeChannel = interaction.options.getChannel('judge_channel', true);
      const embedChannel = interaction.options.getChannel('embed_channel', true);
      const activeChannel = interaction.options.getChannel('active_channel', true);

      setGuildConfig(interaction.guildId, {
        judgeChannelId: judgeChannel.id,
        embedChannelId: embedChannel.id,
        activeChannelId: activeChannel.id,
      });

      const guildConfig = {
        judgeChannel,
        embedChannel,
        activeChannel,
      };

      await postRequestEmbed(guildConfig, interaction.guild.name);

      await interaction.reply({
        content: `Setup complete.\n- Judge sign channel: <#${judgeChannel.id}>\n- Embed channel: <#${embedChannel.id}>\n- Active warrant channel: <#${activeChannel.id}>`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'warrant:start') {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: 'Please use this in a server.', ephemeral: true });
        return;
      }

      const typeSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('warrant:type')
          .setPlaceholder('Select type of warrant')
          .addOptions([
            { label: 'Arrest', value: 'Arrest' },
            { label: 'Search', value: 'Search' },
          ]),
      );

      const userSelect = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('warrant:user')
          .setPlaceholder('Who is the user? (optional)')
          .setMinValues(0)
          .setMaxValues(1),
      );

      const continueRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('warrant:continue').setLabel('Continue').setStyle(ButtonStyle.Success),
      );

      pendingDrafts.set(interaction.user.id, {
        guildId: interaction.guildId,
        requesterId: interaction.user.id,
      });

      await interaction.reply({
        ephemeral: true,
        content: 'Select the warrant type and (optionally) suspect user, then press Continue.',
        components: [typeSelect, userSelect, continueRow],
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'warrant:type') {
      const draft = pendingDrafts.get(interaction.user.id);
      if (!draft) {
        await interaction.reply({ content: 'No draft found. Click the request button again.', ephemeral: true });
        return;
      }

      draft.warrantType = interaction.values[0];
      pendingDrafts.set(interaction.user.id, draft);
      await interaction.reply({ content: `Selected warrant type: **${draft.warrantType}**`, ephemeral: true });
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'warrant:user') {
      const draft = pendingDrafts.get(interaction.user.id);
      if (!draft) {
        await interaction.reply({ content: 'No draft found. Click the request button again.', ephemeral: true });
        return;
      }

      draft.suspectUserId = interaction.values?.[0] || null;
      pendingDrafts.set(interaction.user.id, draft);
      await interaction.reply({
        content: draft.suspectUserId
          ? `Selected suspect: <@${draft.suspectUserId}>`
          : 'No suspect selected (blank).',
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'warrant:continue') {
      const draft = pendingDrafts.get(interaction.user.id);
      if (!draft || !draft.warrantType) {
        await interaction.reply({
          content: 'Please select a warrant type before continuing.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder().setCustomId('warrant:details').setTitle('Warrant Request Details');
      const crimeInput = new TextInputBuilder()
        .setCustomId('crime')
        .setLabel('What crime are they suspected of?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

      const causeInput = new TextInputBuilder()
        .setCustomId('cause')
        .setLabel('What probable cause do you have?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

      const attachmentInput = new TextInputBuilder()
        .setCustomId('attachment_link')
        .setLabel('Suspect photo URL (or type "upload in next step")')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(300);

      modal.addComponents(
        new ActionRowBuilder().addComponents(crimeInput),
        new ActionRowBuilder().addComponents(causeInput),
        new ActionRowBuilder().addComponents(attachmentInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'warrant:details') {
      const draft = pendingDrafts.get(interaction.user.id);
      if (!draft) {
        await interaction.reply({ content: 'Draft expired. Please start again.', ephemeral: true });
        return;
      }

      draft.crime = interaction.fields.getTextInputValue('crime');
      draft.probableCause = interaction.fields.getTextInputValue('cause');
      draft.photoInfo = interaction.fields.getTextInputValue('attachment_link');

      const cfg = getGuildConfig(interaction.guildId);
      if (!cfg) {
        await interaction.reply({ content: 'This server is not configured. Run /setup first.', ephemeral: true });
        return;
      }

      const judgeChannel = await interaction.guild.channels.fetch(cfg.judgeChannelId);
      if (!judgeChannel || judgeChannel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'Judge channel missing. Please run /setup again.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('New Warrant Request')
        .addFields(
          { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Type', value: draft.warrantType, inline: true },
          { name: 'Suspect User', value: draft.suspectUserId ? `<@${draft.suspectUserId}>` : 'Not in server / left blank' },
          { name: 'Suspected Crime', value: draft.crime },
          { name: 'Probable Cause', value: draft.probableCause },
          { name: 'Suspect Photo', value: draft.photoInfo },
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`warrant:approve:${interaction.user.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`warrant:deny:${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
      );

      await judgeChannel.send({ embeds: [embed], components: [row] });
      pendingDrafts.set(interaction.user.id, draft);

      await interaction.reply({
        content: 'Warrant request submitted to judges for review.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('warrant:deny:')) {
      const requesterId = interaction.customId.split(':')[2];
      await interaction.reply({ content: `Warrant denied. <@${requesterId}> has been notified.`, allowedMentions: { parse: [] } });
      const requester = await client.users.fetch(requesterId).catch(() => null);
      if (requester) {
        await requester.send('Your warrant request was denied by a judge.').catch(() => null);
      }
      pendingDrafts.delete(requesterId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('warrant:approve:')) {
      const requesterId = interaction.customId.split(':')[2];
      pendingJudged.set(interaction.user.id, { requesterId, guildId: interaction.guildId });

      const modal = new ModalBuilder().setCustomId('warrant:approval_data').setTitle('Approval Add-ons');
      const fileInput = new TextInputBuilder()
        .setCustomId('file_link')
        .setLabel('Optional file URL')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300);

      const docInput = new TextInputBuilder()
        .setCustomId('doc_link')
        .setLabel('Google Doc link (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300);

      modal.addComponents(
        new ActionRowBuilder().addComponents(fileInput),
        new ActionRowBuilder().addComponents(docInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'warrant:approval_data') {
      const pending = pendingJudged.get(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: 'Approval context expired. Please click Accept again.', ephemeral: true });
        return;
      }

      const requesterId = pending.requesterId;
      const draft = pendingDrafts.get(requesterId);
      if (!draft) {
        await interaction.reply({ content: 'Could not find request draft.', ephemeral: true });
        return;
      }

      const cfg = getGuildConfig(interaction.guildId);
      if (!cfg) {
        await interaction.reply({ content: 'This server is not configured. Run /setup first.', ephemeral: true });
        return;
      }

      const activeChannel = await interaction.guild.channels.fetch(cfg.activeChannelId);
      if (!activeChannel || activeChannel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'Active warrant channel missing. Run /setup again.', ephemeral: true });
        return;
      }

      const fileLink = interaction.fields.getTextInputValue('file_link');
      const docLink = interaction.fields.getTextInputValue('doc_link');

      const approvedEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('Approved Warrant')
        .addFields(
          { name: 'Requester', value: `<@${requesterId}>`, inline: true },
          { name: 'Approved By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Type', value: draft.warrantType, inline: true },
          { name: 'Suspect User', value: draft.suspectUserId ? `<@${draft.suspectUserId}>` : 'Not in server / left blank' },
          { name: 'Suspected Crime', value: draft.crime },
          { name: 'Probable Cause', value: draft.probableCause },
          { name: 'Suspect Photo', value: draft.photoInfo },
          { name: 'Supporting File', value: fileLink || 'N/A' },
          { name: 'Google Doc', value: docLink || 'N/A' },
        )
        .setTimestamp();

      await activeChannel.send({
        content: `<@${requesterId}> your warrant has been approved.`,
        embeds: [approvedEmbed],
      });

      const requester = await client.users.fetch(requesterId).catch(() => null);
      if (requester) {
        await requester.send({
          content: 'Your warrant has been approved.',
          embeds: [approvedEmbed],
        }).catch(() => null);
      }

      pendingJudged.delete(interaction.user.id);
      pendingDrafts.delete(requesterId);
      await interaction.reply({ content: 'Approved warrant posted to active channel and sent to requester DM.', ephemeral: true });
      return;
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable()) {
      const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
      await interaction[method]({ content: 'Something went wrong while handling that interaction.', ephemeral: true }).catch(() => null);
    }
  }
});

client.login(DISCORD_TOKEN);
