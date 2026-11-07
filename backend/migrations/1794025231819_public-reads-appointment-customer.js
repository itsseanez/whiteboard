// Emails to a customer after a cancel or move made from their manage link need
// the appointment's customer, which the public role could not read. It could
// already read customer.email; this only lets it follow the link to it, and
// only ever for an appointment the caller has proved, by its token, is theirs.

exports.up = (pgm) => {
  pgm.sql('GRANT SELECT (customer_id) ON appointment TO whiteboard_public;');
};

exports.down = (pgm) => {
  pgm.sql('REVOKE SELECT (customer_id) ON appointment FROM whiteboard_public;');
};
