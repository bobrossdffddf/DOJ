import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
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
  const container = new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Warrant Request Form\nUse the button below to submit a warrant request for **${guildName}**.\n\nThe form will ask you for:\n- Warrant type (Arrest or Search)\n- Suspect's user ID *(optional)*\n- Suspected crime\n- Probable cause\n- Suspect photo URL`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('warrant:start')
          .setLabel('Create Warrant Request')
          .setStyle(ButtonStyle.Primary),
      ),
    );

  return guildConfig.embedChannel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
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

      await postRequestEmbed({ judgeChannel, embedChannel, activeChannel }, interaction.guild.name);

      await interaction.reply({
        content: `Setup complete.\n- Judge channel: <#${judgeChannel.id}>\n- Embed channel: <#${embedChannel.id}>\n- Active warrant channel: <#${activeChannel.id}>`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'warrant:start') {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: 'Please use this in a server.', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('warrant:request')
        .setTitle('Warrant Request Form');

      const typeInput = new TextInputBuilder()
        .setCustomId('warrant_type')
        .setLabel('Warrant Type')
        .setPlaceholder('Arrest or Search')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10);

      const suspectInput = new TextInputBuilder()
        .setCustomId('suspect_id')
        .setLabel('Suspect User ID (optional)')
        .setPlaceholder('Paste their Discord user ID, or leave blank')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(25);

      const crimeInput = new TextInputBuilder()
        .setCustomId('crime')
        .setLabel('Suspected Crime')
        .setPlaceholder('Describe the crime the suspect is accused of')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

      const causeInput = new TextInputBuilder()
        .setCustomId('cause')
        .setLabel('Probable Cause')
        .setPlaceholder('Describe the evidence or reasoning supporting this warrant')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

      const photoInput = new TextInputBuilder()
        .setCustomId('photo')
        .setLabel('Suspect Photo URL')
        .setPlaceholder('Paste a direct image URL')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(suspectInput),
        new ActionRowBuilder().addComponents(crimeInput),
        new ActionRowBuilder().addComponents(causeInput),
        new ActionRowBuilder().addComponents(photoInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'warrant:request') {
      const rawType = interaction.fields.getTextInputValue('warrant_type').trim();
      const warrantType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();

      if (warrantType !== 'Arrest' && warrantType !== 'Search') {
        await interaction.reply({
          content: 'Invalid warrant type. Please enter either **Arrest** or **Search**.',
          ephemeral: true,
        });
        return;
      }

      const suspectRaw = interaction.fields.getTextInputValue('suspect_id').trim();
      const suspectUserId = suspectRaw.length > 0 ? suspectRaw : null;
      const crime = interaction.fields.getTextInputValue('crime');
      const probableCause = interaction.fields.getTextInputValue('cause');
      const photoInfo = interaction.fields.getTextInputValue('photo');

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

      const suspectDisplay = suspectUserId ? `<@${suspectUserId}>` : '*Not specified*';
      const timestamp = Math.floor(Date.now() / 1000);

      const container = new ContainerBuilder()
        .setAccentColor(0xf1c40f)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## New Warrant Request\n` +
            `**Requester:** <@${interaction.user.id}>\n` +
            `**Type:** ${warrantType}\n` +
            `**Suspect:** ${suspectDisplay}\n`,
          ),
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Suspected Crime**\n${crime}\n\n` +
            `**Probable Cause**\n${probableCause}\n\n` +
            `**Suspect Photo**\n${photoInfo}\n\n` +
            `-# Submitted <t:${timestamp}:R>`,
          ),
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`warrant:approve:${interaction.user.id}`)
              .setLabel('Accept')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`warrant:deny:${interaction.user.id}`)
              .setLabel('Deny')
              .setStyle(ButtonStyle.Danger),
          ),
        );

      pendingDrafts.set(interaction.user.id, {
        guildId: interaction.guildId,
        requesterId: interaction.user.id,
        warrantType,
        suspectUserId,
        crime,
        probableCause,
        photoInfo,
      });

      await judgeChannel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });

      await interaction.reply({
        content: 'Your warrant request has been submitted to the judges for review.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('warrant:deny:')) {
      const requesterId = interaction.customId.split(':')[2];

      await interaction.reply({
        content: `Warrant denied. <@${requesterId}> has been notified.`,
        allowedMentions: { parse: [] },
      });

      const requester = await client.users.fetch(requesterId).catch(() => null);
      if (requester) {
        await requester.send('Your warrant request was **denied** by a judge.').catch(() => null);
      }

      pendingDrafts.delete(requesterId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('warrant:approve:')) {
      const requesterId = interaction.customId.split(':')[2];
      pendingJudged.set(interaction.user.id, { requesterId, guildId: interaction.guildId });

      const modal = new ModalBuilder()
        .setCustomId('warrant:approval_data')
        .setTitle('Approval Add-ons');

      const fileInput = new TextInputBuilder()
        .setCustomId('file_link')
        .setLabel('Supporting File URL (optional)')
        .setPlaceholder('Direct link to any supporting file')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500);

      const docInput = new TextInputBuilder()
        .setCustomId('doc_link')
        .setLabel('Google Doc Link (optional)')
        .setPlaceholder('Link to warrant document')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500);

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
        await interaction.reply({ content: 'Could not find the original request. It may have already been processed.', ephemeral: true });
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

      const fileLink = interaction.fields.getTextInputValue('file_link').trim();
      const docLink = interaction.fields.getTextInputValue('doc_link').trim();
      const suspectDisplay = draft.suspectUserId ? `<@${draft.suspectUserId}>` : '*Not specified*';
      const timestamp = Math.floor(Date.now() / 1000);

      const approvedContainer = new ContainerBuilder()
        .setAccentColor(0x2ecc71)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Approved Warrant\n` +
            `**Requester:** <@${requesterId}>\n` +
            `**Approved By:** <@${interaction.user.id}>\n` +
            `**Type:** ${draft.warrantType}\n` +
            `**Suspect:** ${suspectDisplay}\n`,
          ),
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Suspected Crime**\n${draft.crime}\n\n` +
            `**Probable Cause**\n${draft.probableCause}\n\n` +
            `**Suspect Photo**\n${draft.photoInfo}\n\n` +
            `**Supporting File**\n${fileLink || '*None provided*'}\n\n` +
            `**Google Doc**\n${docLink || '*None provided*'}\n\n` +
            `-# Approved <t:${timestamp}:R>`,
          ),
        );

      await activeChannel.send({
        content: `<@${requesterId}> your warrant has been approved.`,
        components: [approvedContainer],
        flags: MessageFlags.IsComponentsV2,
      });

      const requester = await client.users.fetch(requesterId).catch(() => null);
      if (requester) {
        await requester
          .send({
            content: 'Your warrant has been **approved**.',
            components: [approvedContainer],
            flags: MessageFlags.IsComponentsV2,
          })
          .catch(() => null);
      }

      pendingJudged.delete(interaction.user.id);
      pendingDrafts.delete(requesterId);

      await interaction.reply({
        content: 'Approved warrant posted to the active channel and sent to the requester via DM.',
        ephemeral: true,
      });
      return;
    }
  } catch (error) {
    console.error(error);
    if (interaction.isRepliable()) {
      const method = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
      await interaction[method]({
        content: 'Something went wrong while handling that interaction.',
        ephemeral: true,
      }).catch(() => null);
    }
  }
});

client.login(DISCORD_TOKEN);
