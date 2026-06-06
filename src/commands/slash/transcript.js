const { SlashCommand } = require('@eartharoid/dbf');
const {
	ApplicationCommandOptionType,
	PermissionsBitField,
	MessageFlags,
} = require('discord.js');
const fs = require('fs');
const { join } = require('path');
const Mustache = require('mustache');
const { AttachmentBuilder } = require('discord.js');
const ExtendedEmbedBuilder = require('../../lib/embed');
const { pools } = require('../../lib/threads');

const { transcript: pool } = pools;

module.exports = class TranscriptSlashCommand extends SlashCommand {
	constructor(client, options) {
		const name = 'transcript';
		super(client, {
			...options,
			description: client.i18n.getMessage(null, `commands.slash.${name}.description`),
			descriptionLocalizations: client.i18n.getAllMessages(`commands.slash.${name}.description`),
			dmPermission: false,
			name,
			nameLocalizations: client.i18n.getAllMessages(`commands.slash.${name}.name`),
			options: [
				{
					autocomplete: true,
					name: 'category',
					required: true,
					type: ApplicationCommandOptionType.Integer,
				},
				{
					autocomplete: true,
					name: 'ticket',
					required: true,
					type: ApplicationCommandOptionType.String,
				},
			].map(option => {
				option.descriptionLocalizations = client.i18n.getAllMessages(`commands.slash.${name}.options.${option.name}.description`);
				option.description = option.descriptionLocalizations['en-GB'] || `Select the ${option.name}`;
				option.nameLocalizations = client.i18n.getAllMessages(`commands.slash.${name}.options.${option.name}.name`);
				return option;
			}),
		});

		Mustache.escape = text => text; // don't HTML-escape
		
		const templateName = this.client.config.templates.transcript + '.mustache';
		const paths = [
			join('./user/templates/', templateName),
			join(__dirname, '../../user/templates/', templateName),
			join(__dirname, '../../user/templates/transcript.html.mustache'), // fallback to HTML
		];

		for (const p of paths) {
			if (fs.existsSync(p)) {
				this.template = fs.readFileSync(p, { encoding: 'utf8' });
				break;
			}
		}

		if (!this.template) {
			throw new Error(`Template not found in any of the following paths: ${paths.join(', ')}`);
		}
	}

	shouldAllowAccess(interaction, ticket) {
		if (ticket.createdById === interaction.user.id) return true;
		if (interaction.guild?.id !== ticket.guildId) return false;
		if (interaction.client.supers.includes(interaction.member.id)) return true;
		if (interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
		if (interaction.member.roles.cache.filter(role => ticket.category.staffRoles.includes(role.id)).size > 0) return true;
		return false;
	}

	async fillTemplate(ticket) {
		const client = this.client;

		ticket = await pool.queue(w => w({
			encryptionKey: process.env.ENCRYPTION_KEY,
			ticket,
		}));

		// Set isImage flag on attachments and convert to base64 so they can be rendered reliably in the template
		if (ticket.archivedMessages) {
			const promises = [];
			for (const msg of ticket.archivedMessages) {
				if (!msg.content?.attachments) continue;
				for (const a of msg.content.attachments) {
					a.isImage = !!a.contentType?.match(/image\/(png|jpe?g|gif|webp)/i);
					a.isVideo = !!a.contentType?.match(/video\/(mp4|webm|ogg|quicktime|mov)/i);
					if (a.isImage && !(a.url || a.attachment)?.startsWith('data:')) {
						const localPath = join(process.cwd(), 'user', 'attachments', `${a.id}_${a.filename}`);
						if (fs.existsSync(localPath)) {
							const buffer = fs.readFileSync(localPath);
							a.url = `data:${a.contentType};base64,${buffer.toString('base64')}`;
						} else {
							// fallback network fetch
							promises.push(
								fetch(a.url || a.attachment)
									.then(res => {
										if (!res.ok) return;
										return res.arrayBuffer().then(buffer => {
											a.url = `data:${a.contentType};base64,${Buffer.from(buffer).toString('base64')}`;
										});
									})
									.catch(() => {})
							);
						}
					}
				}
			}
			await Promise.all(promises);
		}

		const channelName = ticket.category.channelName
			.replace(/{+\s?(user)?name\s?}+/gi, ticket.createdBy?.username || 'unknown')
			.replace(/{+\s?(nick|display)(name)?\s?}+/gi, ticket.createdBy?.displayName || ticket.createdBy?.username || 'unknown')
			.replace(/{+\s?num(ber)?\s?}+/gi, ticket.number);
		
		const extension = this.template.includes('<!DOCTYPE html>') ? 'html' : this.client.config.templates.transcript.split('.').slice(-1)[0];
		const fileName = `${channelName}.${extension}`;
		
		const transcript = Mustache.render(this.template, {
			channelName,
			closedAtFull: function () {
				if (!this.closedAt) return 'N/A';
				return new Intl.DateTimeFormat([ticket.guild.locale, 'en-GB'], {
					dateStyle: 'full',
					timeStyle: 'long',
					timeZone: 'Etc/UTC',
				}).format(this.closedAt);
			},
			createdAtFull: function () {
				if (!this.createdAt) return 'N/A';
				return new Intl.DateTimeFormat([ticket.guild.locale, 'en-GB'], {
					dateStyle: 'full',
					timeStyle: 'long',
					timeZone: 'Etc/UTC',
				}).format(this.createdAt);
			},
			createdAtTimestamp: function () {
				if (!this.createdAt) return 'N/A';
				return new Intl.DateTimeFormat([ticket.guild.locale, 'en-GB'], {
					dateStyle: 'short',
					timeStyle: 'long',
					timeZone: 'Etc/UTC',
				}).format(this.createdAt);
			},
			guildName: client.guilds.cache.get(ticket.guildId)?.name,
			pinned: ticket.pinnedMessageIds.join(', '),
			ticket,
		});

		return {
			fileName,
			transcript,
		};
	}

	async run(interaction, ticketId) {
		const client = this.client;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		ticketId = ticketId || interaction.options.getString('ticket', true);
		const category = interaction.options.getInteger('category', true);

		const where = interaction.guildId && ticketId.length < 16
			? {
				guildId_number: {
					guildId: interaction.guildId,
					number: parseInt(ticketId),
				},
			}
			: { id: ticketId };

		if (category !== -1) where.categoryId = category;

		if (where.id || where.guildId_number) {
			const ticket = await client.prisma.ticket.findFirst({
					include: {
						archivedChannels: true,
						archivedMessages: {
							orderBy: { createdAt: 'asc' },
							where: { external: false },
						},
						archivedRoles: true,
						archivedUsers: true,
						category: true,
						claimedBy: true,
						closedBy: true,
						createdBy: true,
						feedback: true,
						guild: true,
						questionAnswers: { include: { question: true } },
					},
					where,
				});
				return this.handleResult(interaction, ticket, ticketId);
		}

		// If no specific ticketId was matched above (which shouldn't happen due to required ticket option, but just in case)
		const ticket = await client.prisma.ticket.findUnique({
			include: {
				archivedChannels: true,
				archivedMessages: {
					orderBy: { createdAt: 'asc' },
					where: { external: false },
				},
				archivedRoles: true,
				archivedUsers: true,
				category: true,
				claimedBy: true,
				closedBy: true,
				createdBy: true,
				feedback: true,
				guild: true,
				questionAnswers: { include: { question: true } },
			},
			where,
		});

		return this.handleResult(interaction, ticket, ticketId);
	}

	async handleResult(interaction, ticket, ticketId) {
		const client = this.client;
		if (!ticket) throw new Error(`Ticket ${ticketId} does not exist`);

		if (!this.shouldAllowAccess(interaction, ticket)) {
			const settings = await client.prisma.guild.findUnique({ where: { id: interaction.guild.id } });
			const getMessage = client.i18n.getLocale(settings.locale);
			return await interaction.editReply({
				embeds: [
					new ExtendedEmbedBuilder({
						iconURL: interaction.guild.iconURL(),
						text: ticket.guild.footer,
					})
						.setColor(ticket.guild.errorColour)
						.setTitle(getMessage('commands.slash.transcript.not_staff.title'))
						.setDescription(getMessage('commands.slash.transcript.not_staff.description')),
				],
			});
		}

		// 1. If no messages in archive, try to fetch from channel (LIVE RECOVERY)
		if (ticket.archivedMessages.length === 0 && ticket.open) {
			const channel = client.channels.cache.get(ticket.id);
			if (channel) {
				const messages = await channel.messages.fetch({ limit: 100 });
				for (const m of messages.values()) {
					await client.tickets.archiver.saveMessage(ticket.id, m);
				}
				// Refresh ticket data
				const updatedTicket = await client.prisma.ticket.findUnique({
					include: {
						archivedChannels: true,
						archivedMessages: { orderBy: { createdAt: 'asc' }, where: { external: false } },
						archivedRoles: true,
						archivedUsers: true,
						category: true,
						claimedBy: true,
						closedBy: true,
						createdBy: true,
						feedback: true,
						guild: true,
						questionAnswers: { include: { question: true } },
					},
					where: { id: ticket.id },
				});
				if (updatedTicket) ticket = updatedTicket;
			}
		}

		const {
			fileName,
			transcript,
		} = await this.fillTemplate(ticket);
		const attachment = new AttachmentBuilder(Buffer.from(transcript), { name: fileName });

		await interaction.editReply({ files: [attachment] });
	}
};
