const { isStaff } = require('./users');
const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
} = require('discord.js');
const ExtendedEmbedBuilder = require('./embed');

module.exports = async function handleStaleTickets(client, staleInterval) {
	client.log.info.cron('Handling auto-close tickets');
	const guilds = await client.prisma.guild.findMany({
		include: {
			tickets: {
				include: { category: true },
				where: { open: true },
			},
		},
		where: { autoClose: { gte: staleInterval } },
	});
	let processed = 0;
	let closed = 0;

	for (const guild of guilds) {
		for (const ticket of guild.tickets) {
			try {
				processed++;
				if (Date.now() - (ticket.lastMessageAt || ticket.createdAt) >= guild.autoClose) {
					client.log.info.cron(`Auto-closing ticket ${ticket.id} due to inactivity`);
					await client.tickets.finallyClose(ticket.id, { reason: 'inactivity' });
					closed++;
				}
			} catch (error) {
				client.log.error(error);
			}
		}
	}
	client.log.success.cron({
		closed,
		processed,
	});
};