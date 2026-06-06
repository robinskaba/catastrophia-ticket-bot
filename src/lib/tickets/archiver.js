const { pools } = require('../threads');

const { crypto } = pools;

/**
 * Returns highest (roles.highest) hoisted role, or everyone
 * @param {import("discord.js").GuildMember} member
 * @returns {import("discord.js").Role}
 */
const hoistedRole = member => member.roles.hoist || member.guild.roles.everyone;

module.exports = class TicketArchiver {
	constructor(client) {
		/** @type {import("client")} */
		this.client = client;
	}

	/** Add or update a message
	 * @param {string} ticketId
	 * @param {import("discord.js").Message} message
	 * @param {boolean?} external
	 * @returns {import("@prisma/client").ArchivedMessage|boolean}
	 */
	async saveMessage(ticketId, message, external = false) {
		if (process.env.OVERRIDE_ARCHIVE === 'false') return false;
		if (message.author.bot) return false;

		if (!message.member) {
			try {
				message.member = await message.guild.members.fetch(message.author.id);
			} catch {
				this.client.log.verbose('Failed to fetch member %s of %s', message.author.id, message.guild.id);
			}
		}

		const channels = new Set(message.mentions.channels.values());
		const roles = new Set(message.mentions.roles.values());
		const usersToArchive = new Map();

		// Add the author first to ensure they are always archived
		usersToArchive.set(message.author.id, {
			member: message.member,
			user: message.author,
		});

		// Add mentioned members
		message.mentions.members.forEach(m => {
			usersToArchive.set(m.id, {
				member: m,
				user: m.user,
			});
		});

		try {
			const queries = [];

			for (const { member } of usersToArchive.values()) {
				if (member) roles.add(hoistedRole(member));
			}

			for (const role of roles) {
				if (!role) continue;
				const data = {
					colour: role.hexColor.slice(1),
					name: role.name,
				};
				queries.push(
					this.client.prisma.archivedRole.upsert({
						create: {
							...data,
							roleId: role.id,
							ticketId,
						},
						select: { ticketId: true },
						update: data,
						where: {
							ticketId_roleId: {
								roleId: role.id,
								ticketId,
							},
						},
					})
				);
			}

			for (const { member, user } of usersToArchive.values()) {
				const displayName = member?.displayName || user.username;
				const data = {
					avatar: member?.avatar || user.avatar,
					bot: user.bot,
					discriminator: user.discriminator,
					displayName: displayName ? await crypto.queue(w => w.encrypt(displayName)) : null,
					roleId: member ? hoistedRole(member).id : null,
					username: await crypto.queue(w => w.encrypt(user.username)),
				};
				queries.push(
					this.client.prisma.archivedUser.upsert({
						create: {
							...data,
							ticketId,
							userId: user.id,
						},
						select: { ticketId: true },
						update: data,
						where: {
							ticketId_userId: {
								ticketId,
								userId: user.id,
							},
						},
					})
				);
			}

			for (const channel of channels) {
				const data = {
					channelId: channel.id,
					name: channel.name,
					ticketId,
				};
				queries.push(
					this.client.prisma.archivedChannel.upsert({
						create: data,
						select: { ticketId: true },
						update: data,
						where: {
							ticketId_channelId: {
								channelId: channel.id,
								ticketId,
							},
						},
					})
				);
			}

			const fs = require('fs');
			const { join } = require('path');
			const userAttachmentsDir = join(process.cwd(), 'user', 'attachments');
			if (!fs.existsSync(userAttachmentsDir)) fs.mkdirSync(userAttachmentsDir, { recursive: true });

			const attachments = [];
			for (const a of message.attachments.values()) {
				const att = {
					contentType: a.contentType,
					filename: a.name || a.filename || 'attachment',
					id: a.id,
					url: a.url || a.attachment,
				};
				if (att.contentType?.match(/image\/(png|jpe?g|gif|webp)/i)) {
					// download to local disk instead of db to avoid P2000 text limit
					fetch(att.url).then(res => res.ok ? res.arrayBuffer() : null).then(buffer => {
						if (buffer) {
							fs.writeFileSync(join(userAttachmentsDir, `${att.id}_${att.filename}`), Buffer.from(buffer));
						}
					}).catch(() => {});
				}
				attachments.push(att);
			}

			const contentStr = JSON.stringify({
				attachments,
				components: [...message.components.values()],
				content: message.content || '',
				embeds: message.embeds.map(embed => ({ ...embed })),
				reference: message.reference?.messageId ?? null,
			});

			const data = {
				content: await crypto.queue(w => w.encrypt(contentStr)),
				createdAt: message.createdAt,
				edited: !!message.editedAt,
				external,
			};

			queries.push(
				this.client.prisma.archivedMessage.upsert({
					create: {
						...data,
						authorId: message.author.id,
						id: message.id,
						ticketId,
					},
					select: { ticketId: true },
					update: data,
					where: { id: message.id },
				})
			);

			// Execute transaction sequentially
			for (const query of queries) {
				await query;
			}
			return true;
		} catch (error) {
			this.client.log.error('Failed to archive message %s', message.id);
			this.client.log.error(error);
			return false;
		}
	}
};
