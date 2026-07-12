const fs = require('fs');

function printTicket(ticket) {
  const content = `
=========================
    LAND TRANSPORTATION
          OFFICE

Queue No: ${ticket.ticket_number}

Service: ${ticket.service_type}

Time: ${new Date().toLocaleTimeString()}

Please wait until your
number is called.
=========================
`;

  console.log(content);

  // Temporary: save printable ticket
  fs.writeFileSync('last-ticket.txt', content);
}

module.exports = { printTicket };
