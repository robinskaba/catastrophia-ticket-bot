/* eslint-disable no-underscore-dangle */
const { Autocompleter } = require('@eartharoid/dbf');
const emoji = require('node-emoji');
const Keyv = require('keyv');
const ms = require('ms');
const { isStaff } = require('../lib/users');
const { pools } = require('../lib/threads');

const { crypto } = pools;

module.exports = class TicketCompleter extends Autocompleter {
	constructor(client, options) {
		super(client, {
			...options,
			id: 'ticket',
		});

		this.cache = new Keyv();
	}

	async getOptions(value, {
		interaction,
		open,
		userId,
		categoryId,
		timeframe,
	}) {
		/** @type {import("client")} */
		const client = this.client;
		const guildId = interaction.guild.id;
		const cacheKey = [guildId, userId || 'all', categoryId || 'all', open, timeframe || 'all', value || 'none'].join('/');

		let tickets = await this.cache.get(cacheKey);

		if (!tickets) {
			const cmd = client.commands.commands.slash.get('transcript');
			const { locale } = await client.prisma.guild.findUnique({
				select: { locale: true },
				where: { id: guildId },
			});
			const where = {
				...(userId ? { createdById: userId } : {}),
				...(categoryId ? { categoryId } : {}),
				guildId,
				open,
			};

			if (timeframe && timeframe !== 'all') {
				const date = new Date();
				date.setDate(date.getDate() - parseInt(timeframe));
				where.createdAt = { gte: date };
			}

			tickets = await client.prisma.ticket.findMany({
				include: {
					archivedUsers: true,
					category: true,
					createdBy: true,
				},
				orderBy: { createdAt: 'desc' },
				where,
				take: 10,
			});

			tickets = await Promise.all(
				tickets
					.filter(ticket => cmd.shouldAllowAccess(interaction, ticket))
					.map(async ticket => {
						const date = new Date(ticket.createdAt).toLocaleString([locale, 'en-GB'], { dateStyle: 'short' });
						const topic = ticket.topic ? '- ' + (await crypto.queue(w => w.decrypt(ticket.topic))).replace(/\n/g, ' ').substring(0, 50) : '';
						
						let creatorDisplayName = ticket.createdBy?.username || 'unknown';
						const archivedCreator = ticket.archivedUsers?.find(u => u.userId === ticket.createdById);
						if (archivedCreator?.displayName) {
							creatorDisplayName = await crypto.queue(w => w.decrypt(archivedCreator.displayName));
						}

						const channelName = ticket.category.channelName
							.replace(/{+\s?(user)?name\s?}+/gi, ticket.createdBy?.username || 'unknown')
							.replace(/{+\s?(nick|display)(name)?\s?}+/gi, creatorDisplayName)
							.replace(/{+\s?num(ber)?\s?}+/gi, ticket.number);
						ticket._name = `#${channelName} (${date}) ${topic}`;
						return ticket;
					})
			);
			
			// Filter out broken tickets (e.g. unknown creator)
			tickets = tickets.filter(t => !t._name.includes('unknown'));

			this.cache.set(cacheKey, tickets, ms('1m'));
		}

		const options = value ? tickets.filter(t => t._name.toLowerCase().includes(value.toLowerCase())) : tickets;
		return options
			.slice(0, 25)
			.map(t => ({
				name: t._name,
				value: t.id,
			}));
	}

	/**
	 * @param {string} value
	 * @param {*} command
	 * @param {import("discord.js").AutocompleteInteraction} interaction
	 */
	async run(value, command, interaction) {
		const categoryOption = interaction.options.get('category');
		const timeframeOption = interaction.options.get('timeframe');
		
		const isUserStaff = await isStaff(interaction.guild, interaction.user.id);
		
		let userId;
		if (!isUserStaff) {
			userId = interaction.user.id;
		}

		let categoryId = categoryOption?.value;
		if (categoryId === -1) categoryId = undefined;
		
		let timeframe = timeframeOption?.value;

		await interaction.respond(
			await this.getOptions(value, {
				interaction,
				open: ['close', 'remove'].includes(command.name),
				userId,
				categoryId,
				timeframe,
			}),
		);
	}
};
