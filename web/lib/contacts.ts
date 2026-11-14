import type { StaticImageData } from "next/image";
import friseur from "@/assets/contacts/friseur.jpg";
import pizzeria from "@/assets/contacts/pizzeria.jpg";
import taxi from "@/assets/contacts/taxi.jpg";
import weber from "@/assets/contacts/weber.jpg";

// Photos from Pexels (free licence): Layth Mushreq #37272296, Kampus Production #6605422,
// Tim Samuel #5835591, Marcelo Verfe #18483772.
// Same order as MOCK_CONTACTS.
export const CONTACT_PHOTOS: StaticImageData[] = [weber, pizzeria, taxi, friseur];
