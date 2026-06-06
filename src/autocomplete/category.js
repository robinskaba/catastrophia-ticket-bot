const { Autocompleter } = require('@eartharoid/dbf');

module.exports = class CategoryCompleter extends Autocompleter {
	constructor(client, options) {
		super(client, {
			...options,
			id: 'category',
		});
	}

	/**
	 * @param {string} value
	 * @param {*} command
	 * @param {import("discord.js").AutocompleteInteraction} interaction
	 */
	async run(value, command, interaction) {
		/** @type {import("client")} */
		const client = this.client;

		let categories = await client.prisma.category.findMany({ where: { guildId: interaction.guild.id } });



		const options = value ? categories.filter(category => category.name.match(new RegExp(value, 'i'))) : categories;
		let results = options
				.slice(0, 25)
				.map(category => ({
					name: category.name,
					value: category.id,
				}));

		if (command.name === 'transcript') {
			results.unshift({ name: 'All', value: -1 });
		}

		await interaction.respond(results.slice(0, 25));
	}
};
