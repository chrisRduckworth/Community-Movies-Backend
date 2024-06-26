import { ScreeningOverview, ScreeningDetail } from "../interfaces";
const db = require("../db/connection");
const dayjs = require("dayjs");
const stripeKey = process.env.STRIPE_KEY!;
const frontendDomain = process.env.FRONTEND_DOMAIN!;
const stripe = require("stripe")(stripeKey);
const axios = require("axios");

exports.fetchScreenings = async (): Promise<ScreeningOverview[]> => {
  const { rows }: any = await db.query(`
  SELECT 
    screening_id,
    title,
    year,
    poster_url,
    location,
    date,
    cost,
    is_pay_what_you_want
  FROM screenings
  WHERE date >= CURRENT_TIMESTAMP
  ORDER BY date ASC;`);
  const screenings: ScreeningOverview[] = rows.map((screening: any) => {
    const {
      screening_id,
      title,
      year,
      poster_url,
      location,
      date,
      cost,
      is_pay_what_you_want,
    } = screening;
    return {
      film: {
        title,
        year,
        poster_url,
      },
      screening_id,
      location,
      date: dayjs(date).format(),
      cost,
      is_pay_what_you_want,
    };
  });
  return screenings;
};

exports.fetchScreeningDetails = async (
  screening_id: string
): Promise<ScreeningDetail> => {
  const { rows } = await db.query(
    `
    SELECT 
      date,
      location,
      cost,
      is_pay_what_you_want,
      title,
      year,
      backdrop_url,
      logo_url,
      description
    FROM screenings
    WHERE screening_id = $1;
    `,
    [screening_id]
  );

  if (rows.length === 0) {
    throw {
      status: 404,
      msg: "Screening not found",
    };
  }

  const {
    title,
    year,
    backdrop_url,
    logo_url,
    description,
    date,
    location,
    cost,
    is_pay_what_you_want,
  } = rows[0];

  const screening = {
    film: {
      title,
      year,
      backdrop_url,
      logo_url,
      description,
    },
    date,
    location,
    cost,
    is_pay_what_you_want,
  };

  return screening;
};

exports.createCheckout = async (screening_id: string, charge: any) => {
  const { rows } = await db.query(
    `
    SELECT 
      title, 
      cost, 
      is_pay_what_you_want 
    FROM screenings
    WHERE screening_id = $1;
`,
    [screening_id]
  );

  if (rows.length === 0) {
    throw {
      status: 404,
      msg: "Screening not found",
    };
  }

  const { title, cost, is_pay_what_you_want } = rows[0];

  if (!is_pay_what_you_want && cost !== charge) {
    throw {
      status: 400,
      msg: "Invalid charge",
    };
  }

  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: "GBP",
          product_data: {
            name: `Ticket ${title}`,
          },
          unit_amount: charge,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${frontendDomain}screenings/${screening_id}/book/{CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendDomain}screenings/${screening_id}/book`,
    metadata: {
      screening_id,
    },
  });

  return session.url;
};

exports.createBooking = async (
  booking_id: string,
  screening_id: string,
  email: string,
  charge: number
) => {
  const { rows } = await db.query(
    `
    INSERT INTO bookings
      (booking_id, screening_id, email, charge)
    VALUES 
      ($1, $2, $3, $4)
    RETURNING *;
    `,
    [booking_id, screening_id, email, charge]
  );
  return rows[0];
};

exports.createScreening = async (
  tmdb_id: any,
  location: any,
  date: any,
  cost: any,
  is_pay_what_you_want: any
) => {
  if (
    typeof location !== "string" ||
    typeof date !== "string" ||
    typeof cost !== "number" ||
    typeof is_pay_what_you_want !== "boolean"
  ) {
    throw {
      status: 400,
      msg: "Invalid body",
    };
  }

  if (is_pay_what_you_want && cost > 0) {
    throw {
      status: 400,
      msg: "is_pay_what_you_want cannot be true when cost is greater than 0",
    };
  }

  const tmdbKey = process.env.TMDB_KEY;
  const tmdbApi = axios.create({
    baseURL: "https://api.themoviedb.org/3",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${tmdbKey}`,
    },
  });
  let data;
  let images;
  try {
    data = await tmdbApi.get(`/movie/${tmdb_id}`);

    images = await tmdbApi.get(
      `/movie/${tmdb_id}/images?include_image_language=en`
    );
  } catch (e: any) {
    if (e.response.data.status_code === 34) {
      throw {
        status: 400,
        msg: "Movie not found",
      };
    }
    if (e.response.data.status_code === 6) {
      throw {
        status: 400,
        msg: "Invalid tmdb id",
      };
    }
    throw e;
  }
  data = data.data;
  
  const title = data.original_title;
  const year = data.release_date.slice(0, 4);
  const description = data.overview;

  const poster_url =
    images.data.posters.length > 0
      ? `https://image.tmdb.org/t/p/original${images.data.posters[0].file_path}`
      : "https://www.themoviedb.org/assets/2/v4/glyphicons/basic/glyphicons-basic-38-picture-grey-c2ebdbb057f2a7614185931650f8cee23fa137b93812ccb132b9df511df1cfac.svg";
  const backdrop_url =
    images.data.backdrops.length > 0
      ? `https://image.tmdb.org/t/p/original${images.data.backdrops[0].file_path}`
      : "https://www.themoviedb.org/assets/2/v4/glyphicons/basic/glyphicons-basic-38-picture-grey-c2ebdbb057f2a7614185931650f8cee23fa137b93812ccb132b9df511df1cfac.svg";

  const { rows } = await db.query(
    `
    INSERT INTO screenings
      (
        date, 
        location, 
        cost, 
        is_pay_what_you_want, 
        tmdb_id,
        title,
        year,
        poster_url,
        backdrop_url,
        description
      )
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *;`,
    [
      date,
      location,
      cost,
      is_pay_what_you_want,
      tmdb_id,
      title,
      year,
      poster_url,
      backdrop_url,
      description,
    ]
  );
  return {
    screening_id: rows[0].screening_id,
    location: rows[0].location,
    date: rows[0].date,
    cost: rows[0].cost,
    is_pay_what_you_want: rows[0].is_pay_what_you_want,
    film: {
      tmdb_id: rows[0].tmdb_id,
      title: rows[0].title,
      year: rows[0].year,
      poster_url: rows[0].poster_url,
      backdrop_url: rows[0].backdrop_url,
      description: rows[0].description,
    },
  };
};

exports.fetchBooking = async (screening_id: any, booking_id: any) => {
  const { rows } = await db.query(
    `
    SELECT 
      booking_id, email, charge, date, location, title, year
    FROM bookings 
    JOIN screenings
    ON bookings.screening_id = screenings.screening_id
    WHERE booking_id=$1 AND screenings.screening_id=$2;
`,
    [booking_id, screening_id]
  );

  if (rows.length === 0) {
    throw {
      status: 404,
      msg: "No booking found",
    };
  }

  const {
    booking_id: id,
    email,
    charge,
    date,
    location,
    title,
    year,
  } = rows[0];
  return {
    booking_id: id,
    email,
    charge,
    screening: {
      date,
      location,
      title,
      year,
    },
  };
};
