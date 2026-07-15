const fs = require('fs');

function printTicket(ticket) {
  const concernLine = ticket.concern ? `Concern: ${ticket.concern}\n\n` : '';
  const content = `
=========================
    LAND TRANSPORTATION
          OFFICE

Queue No: ${ticket.ticket_number}

Service: ${ticket.service_type}
${concernLine}Time: ${new Date().toLocaleTimeString()}

Please wait until your
number is called.
=========================
`;

  console.log(content);

  // Temporary: save printable ticket
  fs.writeFileSync('last-ticket.txt', content);
}

module.exports = { printTicket };
