const { expose } = require('threads/worker');
const Cryptr = require('cryptr');
const { decrypt: defaultDecrypt } = require('../crypto');

function getTranscript(data) {
	let decrypt = defaultDecrypt;
	let ticket = data;

	if (data && data.encryptionKey && data.ticket) {
		const cryptr = new Cryptr(data.encryptionKey);
		decrypt = (val) => {
			try {
				return cryptr.decrypt(val);
			} catch {
				return val;
			}
		};
		ticket = data.ticket;
	} else if (data && data.ticket) {
		ticket = data.ticket;
	}

	const safeDecrypt = (val) => {
		if (!val) return val;
		try { return decrypt(val); } catch { return val; }
	};

	const defaultUser = {
		discriminator: '0000',
		displayName: 'Unknown User',
		username: 'unknown',
	};

	ticket.claimedBy = ticket.archivedUsers.find(u => u.userId === ticket.claimedById) || defaultUser;
	ticket.closedBy = ticket.archivedUsers.find(u => u.userId === ticket.closedById) || defaultUser;
	ticket.createdBy = ticket.archivedUsers.find(u => u.userId === ticket.createdById) || defaultUser;

	if (ticket.closedReason) ticket.closedReason = safeDecrypt(ticket.closedReason);
	if (ticket.feedback?.comment) ticket.feedback.comment = safeDecrypt(ticket.feedback.comment);
	if (ticket.topic) ticket.topic = safeDecrypt(ticket.topic).replace(/\n/g, '\n\t');

	ticket.archivedUsers.forEach((user, i) => {
		if (user.displayName) user.displayName = safeDecrypt(user.displayName);
		if (user.username) user.username = safeDecrypt(user.username);
		ticket.archivedUsers[i] = user;
	});

	ticket.archivedMessages.forEach((message, i) => {
		message.author = ticket.archivedUsers.find(u => u.userId === message.authorId) || defaultUser;
		const decrypted = safeDecrypt(message.content);
		try {
			message.content = JSON.parse(decrypted);
		} catch {
			message.content = { content: decrypted };
		}

		message.text = message.content.content?.replace(/\n/g, '\n\t') ?? '';
		message.content.attachments?.forEach(a => (message.text += '\n\t' + a.url));
		message.content.embeds?.forEach(() => (message.text += '\n\t[embedded content]'));
		message.number = 'M' + String(i + 1).padStart(ticket.archivedMessages.length.toString().length, '0');
		ticket.archivedMessages[i] = message;
	});

	ticket.questionAnswers = ticket.questionAnswers.map(answer => {
		if (answer.value) answer.value = safeDecrypt(answer.value);
		return answer;
	});

	ticket.pinnedMessageIds = ticket.pinnedMessageIds.map(id => ticket.archivedMessages.find(message => message.id === id)?.number);

	return ticket;
}

expose(getTranscript);
